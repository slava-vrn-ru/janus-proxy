var fs = require('fs');

function Jalog() {
  var self = this;
  this.startTime = new Date().toISOString();
  
  this.log = function(idxEnt, type, msg) {
    var fName = './'+self.startTime+' '+idxEnt+' ';
    var t = new Date().toISOString();
    //var toRec = t
    fs.appendFile(fName, t+' '+type+' '+msg+'\n', function(e){
      if (e) console.log('Error write file:', e);
    });
  };
  
}

exports.Jalog = Jalog;