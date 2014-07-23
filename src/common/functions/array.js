// Function to remove an element from an array based on a regex
function removeMatching(originalArray, regex) {
   var j = 0;
   while (j < originalArray.length) {
      if (regex.test(originalArray[j])){
         originalArray.splice(j, 1);
      }
      else{
         j++;
      }
   }
   return originalArray;
}
