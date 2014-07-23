//Exactly like String.replace except it ignores matches inside of single or double quotes
function replaceIgnoreQuoted(string, find, replaceOrCb){
   var quotedString = /(["'])(?:\\?.)*?\1/g;

   var indexOfStrings = [], match;
   quotedString.lastIndex = 0;

   while(match = quotedString.exec(string)){
      indexOfStrings = indexOfStrings.concat([match.index, quotedString.lastIndex]);
   }

   var ret = string.replace(find, function(matched){
      if(!isQuoted(arguments[arguments.length - 2], indexOfStrings)){
         if(typeof replaceOrCb === 'string'){
            return replaceOrCb
         } else{
            return replaceOrCb(matched, index, original)
         }
      } else{
         return matched;
      }
   });

   return ret;

   function isQuoted(startIndex, indexOfStrings){
      var isQuoted = false;
      for(var i = 0; i < indexOfStrings.length; i = i + 2){
         if(startIndex > indexOfStrings[i] && startIndex < indexOfStrings[i+1]){
            isQuoted = true;
            break;
         }
      }
      return isQuoted;
   }
}
