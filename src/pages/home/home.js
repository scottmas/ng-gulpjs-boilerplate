someApp
   .config(function($stateProvider, $urlRouterProvider) {

      $stateProvider
         .state('home', { url: '/', templateUrl: 'pages/home/home.html'})

   })
   .controller('homeCtrl', function(){

   });


