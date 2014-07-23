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

//Saves you from your own stupidity when you try to run CLI gulp tasks outside project root
process.chdir(__dirname);

//Define the files that will be manipulated in the build steps
var files = {};
files.scripts = glob(flatten([
   getBower('js'),
   'src/common/libs/**/*.js',
   'src/app.js',
   'src/common/**/*.js',
   'src/components/**/*.js',
   'src/pages/**/*.js',
   '!src/**/*.spec.js'
]));

files.styles = glob(flatten([
   getBower('css'),
   'src/common/libs/**/*.css',
   'src/common/**/*.scss',
   'src/components/**/*.scss',
   'src/pages/**/*.scss',
   '!src/common/styleVariables/**/*.scss'
]));

files.templates = glob(flatten([
   'src/common/**/*.jade',
   'src/components/**/*.jade',
   'src/pages/**/*.jade',
]));

files.karma = glob(flatten([
   files['scripts'],
   getBower('js', {devDependencies: true, dependencies: false, exclude: 'bootstrap-sass-official'}), //Convuluted way to get dev only libraries from bower, like angular-mocks
   'src/**/*.spec.js'
]));


/* DEVELOPMENT ONLY TASKS */
/**************************/

gulp.task('dev', ['dev:scripts', 'dev:styles', 'dev:templates', 'server']);

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


gulp.task('dev:styles', ['build-bootstrap-css'], function(){

   //Watch the styleVariables directory and set styleVars.
   //styleVars will be prepended to all scss files before the compilation to css.
   var styleVarFiles = 'src/common/styleVariables/**/*.scss';
   var styleVars = readGlob(styleVarFiles);
   gulp.watch(styleVarFiles, function(){
      styleVars = readGlob(styleVarFiles)
   });

   //Watch styles and rebuild on changes
   gulp.src(files['styles'])
      .pipe($.watch())
      .pipe($.plumber())
      .pipe($.insert.prepend(styleVars))
      .pipe(sassHandler())
      .pipe($.autoprefixer('last 1 version'))
      .pipe(write())
      .pipe(reload());

   //Inject style tags into index.html
   return gulp.src(files['styles'])
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
gulp.task('server', function(){
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
         if(path.extname(file.path) == '.css'){ //Sadly, only css can update w/o refreshing the page.
            $.livereload.changed({path: file.path, type: 'changed'});
         }
         else{
            $.livereload.changed();
         }
      }
      cb(null, file);
   });
}

/* BUILD AND DEPLOYMENT TASKS */
/******************************/

gulp.task('build-bootstrap-css', function(){
   var mainBootstrapFile = getBower('scss', {devDependencies: true, dependencies: false})[0];

   var fileContents = String(fs.readFileSync(mainBootstrapFile)).split('\n');

   //Instead of using the file variables.scss defined in bower, replace it with your our own variables file
   fileContents.some(function(val, i){
      if(val.indexOf('variables') !== -1 && val.indexOf('@import') !== -1){
         fileContents[i] = readGlob("src/common/styleVariables/**/*.scss");
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

//Writes files to their path, which will have been modified somewhere along the stream.
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
   if(files[ext] && files[ext].length){
      return files[ext].map(function(val){
         return unixifyPath(path.relative(process.cwd(), val))
      });
   } else return [];
}

//A thin wrapper for node-sass. We don't use gulp-sass because a) it's not really doing much, and b) errors on it break livereload, even with plumber
function sassHandler(opts){
   return map(function(file, cb){
      try{
         opts = opts || {};
         opts.data = String(file.contents);
         file.path = $.util.replaceExtension(file.path, '.css');
         file.contents = new Buffer(sass.renderSync(opts));
      } catch(err){
         logError("Problem in scss file " + $.util.replaceExtension(file.path, '.scss') + ":\n " + err);
      }
      cb(null, file); //Even when it errors, return the stream. Livereload breaks unless you do this.
   });
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
