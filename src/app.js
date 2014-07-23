someApp = angular.module('someApp', ['ui.router'])
   .config(function($stateProvider, $urlRouterProvider){

      $urlRouterProvider
         .otherwise('/');

   })
   .run(function(){

   });
