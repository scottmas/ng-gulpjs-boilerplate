var gulp = require('gulp'),
    $ = require('gulp-load-plugins')();

var express = require('express'),
    flatten = require('flatten'),
    sass    = require('node-sass'),
    path    = require('path'),
    glob    = require('simple-glob'),
    clc     = require('cli-color'),
    map     = require('map-stream'),
    fs      = require('fs');

//Gulp lets you do commands INSIDE your project, not just at root. This change makes this script still work even in those cases
process.chdir(__dirname);

//Define the files that will be manipulated in the build steps
var files = {};
files.scripts =flatten([
   getBower('js'),
   'src/common/libs/**/*.js',
   'src/app.js',
   'src/common/**/*.js',
   'src/components/**/*.js',
   'src/pages/**/*.js',
   '!src/**/*.spec.js'
]);

files.styles = flatten([
   'src/common/**/*.scss',
   'src/components/**/*.scss',
   'src/pages/**/*.scss',
   '!src/common/styleVariables/*.scss'
]);

files.libCss = flatten([
   getBower('css'),
   'src/common/libs/**/*.css',
]);

files.templates = flatten([
   'src/common/**/*.jade',
   'src/components/**/*.jade',
   'src/pages/**/*.jade',
]);

files.karma = flatten([
   glob(files['scripts']),
   getBower('js', {devDependencies: true, dependencies: false, exclude: 'bootstrap-sass-official'}), //Convuluted way to get dev only libraries from bower, like angular-mocks
   'src/**/*.spec.js'
]);


/* DEVELOPMENT ONLY TASKS */
/**************************/

gulp.task('dev', ['dev:scripts', 'dev:styles', 'dev:templates', 'dev:server'], function(){


   //Helps you remember to restart the dev task and its watchers after you modify the directory structure.
   $.watch({glob: ['src/**', '!src/vendor/**', '!src/e2e/**']})
      .pipe(errorOnAddOrDelete());

   function errorOnAddOrDelete(){
      return map(function(file, cb){
         if(file.event == 'deleted' || file.event == 'added'){
            $.util.beep();
            throw new Error("Stop everything");
         }
      })
   }
});


gulp.task('dev:scripts', function(){

   //Reload page when javascript changes
   gulp.src(files['scripts'])
      .pipe($.watch())
      .pipe(reload());

   //Inject script tags into index.html
   return gulp.src(files['scripts'])
      .pipe($.inject('src/index.html', {ignorePath: 'src', addRootSlash: false}))
      .pipe(write());

});

/*
 *  The style task is the most complicated of all the build steps, mostly because the existing build libraries aren't super robust and require numerous workarounds.
 *  The steps are as follows:
 *    (1) Generate a custom build of twitter bootstrap using the style variables found in src/styleVariables.
 *    (2) Prepend imports to our mixin and variable files found in src/styleVariables. This enables us to:
 *        (a) Not have to manually import every single new scss file we make while still giving us access to variables and mixins
 *        (b) Rebuild individual scss files on change, reducing compile times on huge projects
 *    (3) Fix the file paths in gulp src to be relative and unix like. Otherwise, sass source mapping breaks.
 *    (4) Ensure the file will compile to css. If we don't do this, livereload and gulp-watch break on error, even with plumber.
 *    (5) Add prefixes to all our css 3 styles. The "hack" optoins are required for the plugin to be compatible with source maps.
 *
 */
gulp.task('dev:styles', ['build-bootstrap-css', 'prepend-imports'], function(){

   //Watch styles and rebuild on changes
   gulp.src(files['styles'])
      .pipe($.watch())
      .pipe($.plumber())
      .pipe(fixFilePaths())
      .pipe(ensureCompiles())
      .pipe($.sass({sourceComments: 'map', sourceMap: 'a', includePaths: ['src/common/styleVariables']}))
      .pipe($.autoprefixer('last 1 version', {map: true, from: 'a', to: 'a'}))//The "a" values are necessary to make it work with sass source-maps
      .pipe(write())
      .pipe(reload());

   //Inject style tags into index.html
   return gulp.src(files['libCss'].concat(files['styles']))
      .pipe($.rename({extname: '.css'}))
      .pipe($.inject('src/index.html', {ignorePath: 'src', addRootSlash: false}))
      .pipe(write());

});


gulp.task('dev:templates', function(){

   //Watch jade files, rebuild, and reload on changes
   gulp.src(files['templates'])
      .pipe($.watch())
      .pipe($.plumber())
      .pipe($.jade({pretty:true }))
      .pipe(write())
      .pipe(reload());

   //Also need to watch index.html and reload on changes to it. For many reasons, it's more convenient for index.html to NOT be written in jade
   gulp.src('src/index.html')
      .pipe($.watch())
      .pipe(reload());

});

//Spins up a static asset server at localhost:8080 and a livereload server at the default port
gulp.task('dev:server', function(){
   var livereloadport = 35729,
      serverport = 8080,
      server = express();

   $.util.log('Server starting at localhost:' + serverport + '...')
   server.use(express.static('./src', {hidden: true}));
   server.listen(serverport);
   $.livereload.listen(livereloadport);
});


//TODO: figure out what needs to happen with testing
gulp.task('tdd', function () {
   var watchFiles = files[''].concat(files['testDeps'], files['specFiles']);
   var conf = clone(karmaCommonConf);
   conf.files = getTestFiles();
   karma.server.start(conf, function(exit){process.exit(exit)});
});


//Convenience wrapper for working with gulp livereload.
function reload(){
   return map(function(file, cb){
      if(!reload[file.path]) reload[file.path] = true; //Prevents livereload from firing on the initial file load.
      else{
         if(path.extname(file.path) == '.css'){ //Only css can update w/o refreshing the entire page.
            $.livereload.changed({path: file.path, type: 'changed'});
         }
         else{
            $.livereload.changed();
         }
      }
      cb(null, file);
   });
}

//Prepends all scss files with imports to the files in the styleVariables folder.
gulp.task('prepend-imports', function(){

   var startFlag = '/*Begin imports*/ ';
   var imports = glob('src/common/styleVariables/*.scss').map(function(val){
      return "@import '" + path.basename(val, '.scss') + "'; ";
   }).join('');
   var endFlag = '/*End imports*/';

   var importString = [startFlag, imports, endFlag, '\n'].join('');

   glob(files['styles']).forEach(function(filePath){
      //Only scss files
      if(path.extname(filePath) !== '.scss')
         return;

      var thisFile = fs.readFileSync(filePath).toString();

      //The file already has the requisite imports
      if(thisFile.indexOf(importString) !== -1)
         return;

      //styleVariables folder has changed
      if(thisFile.indexOf(startFlag) !== -1){
         thisFile = thisFile.slice(thisFile.indexOf(endFlag) + endFlag.length + 1);
      }

      fs.writeFileSync(filePath, importString + thisFile);

   });
});

/* BUILD AND DEPLOYMENT TASKS */
/******************************/

gulp.task('build-bootstrap-css', function(){
   var mainBootstrapFile = getBower('scss', {devDependencies: true, dependencies: false})[0];

   var fileContents = String(fs.readFileSync(mainBootstrapFile)).split('\n');

   //Instead of using the file variables.scss defined in bower, replace it with your our own variables file
   fileContents.some(function(val, i){
      if(val.indexOf('variables') !== -1 && val.indexOf('@import') !== -1){
         fileContents[i] = readGlob("src/common/styleVariables/*.scss");
         return true;
      }
   });

   fileContents = fileContents.join('\n');

   var css = sass.renderSync({
      data: fileContents,
      includePaths: [path.dirname(mainBootstrapFile)]
   });

   fs.writeFileSync('src/common/libs/bootstrap-build.css', css);
});

gulp.task('clean', function () {
   // Clear the destination folder
   gulp.src('../dist', { read: false })
      .pipe($.clean({ force: true }));
});

gulp.task('copy-assets', function () {
   gulp.src(['../src/assets'])
      .pipe(gulp.dest('../dist/assets'))
});

gulp.task('build', function() {
   return gulp.src('src/js/*.js')
      .pipe($.concat('main.js'))
      .pipe($.rename({suffix: '.min'}))
      .pipe($.uglify())
      .pipe(gulp.dest('build/js'));
});

//Large projects greatly benefit from type checking. It's painful but should be done occasionally
//Type inference also helps the documentation not get out of sync with the code
gulp.task('google-closure', function(){

})


//Warning: On windows a failing task (called via process.exit(1)) will NOT cause the commit to fail. You can only log errors
gulp.task('pre-commit',  function () {
   return gulp.src('app/scripts/**/*.js')
      .pipe($.jshint('config/jshint.json'))
      .pipe($.jshint.reporter('jshint-stylish'))
      .pipe(preCommitReporter());


   //TODO: enforce code coverage on commits
   //test coverage. Described: http://ariya.ofilabs.com/2013/05/hard-thresholds-on-javascript-code-coverage.html
   //var report = require('istanbul').Report.create('text-summary');


});


/*     Helper Functions      */
/*****************************/

//Writes files to their path, whatever it may currently be in the stream.
function write(){
   return map(function(file, cb){
      fs.writeFile(file.path, String(file.contents), function(){
         cb(null, file);
      });
   });
}

//Parses a glob, reads the files, concatenates them together, and returns the result
function readGlob(someGlob){
   var fileList =  glob(someGlob);
   var concatFiles = "";
   fileList.forEach(function(val){
      concatFiles += String(fs.readFileSync(val)) + "\n";
   });
   return concatFiles;
}

//A thin wrapper for the excellent wiredep library.
function getBower(ext, opts){
   var files = require('wiredep')(opts);
   //Make paths relative to project root
   if(files[ext] && files[ext].length){
      return files[ext].map(function(val){
         return unixifyPath(path.relative(process.cwd(), val))
      });
   } else return [];
}

//Node-sass source maps only work when the file path is relative and unixified.
function fixFilePaths(){
   return map(function(file, cb){
      file.path = unixifyPath(path.relative(file.cwd, file.path));
      cb(null, file);
   })
};

//Gulp watch and source maps don't play nicely together. Have to do a simple renderSync (regular render breaks) to make sure
function ensureCompiles(){
   return map(function(file, cb){
      try{
         sass.renderSync({data: String(file.contents), includePaths: ['src/common/styleVariables']})
         cb(null, file); //All is well. Let the file pass down the stream.
      } catch(err){
         cb(); //Remove the file from the stream.
      }
   })
}

//Used for the pre-commit hook
function preCommitReporter() {
   return map(function (file, cb) {
      if (!file.jshint.success) {
         console.error("Your pre-commit check failed!\n" +
            "If you are a non-windows OS, your commit was not pushed to the repository. " +
            "If you are on windows, revert this commit with \"git reset --soft\"");
         process.exit(1);
      }
      cb(null, file);
   });
}

function clone(oldObject){
   return JSON.parse(JSON.stringify(oldObject));
}

function unixifyPath(thisPath){
   thisPath = path.normalize(thisPath);
   return thisPath.replace(/\\/g, "/");
}

function logError(text){
   console.error(clc.red.bold(text));
}
