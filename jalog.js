var fs = require('fs');

function Jalog() {
  var self = this;

  this.textTime = function(isforFile = false) {
    var d = new Date();
    var sep = isforFile ? '-' : ':';
    return String(d.getDate()).padStart(2, '0')+' '+String(d.getHours()).padStart(2, '0')+sep+String(d.getMinutes()).padStart(2, '0')+sep+
        String(d.getSeconds()).padStart(2, '0')+sep+String(d.getMilliseconds()).padStart(3, '0');
  };

  this.startTime = this.textTime(true);
  
  this.log = function(idxEnt, type, msg, obj) {
    var fName = './'+self.startTime+' '+idxEnt+' ';
    var t = self.textTime();
    var toRec = t+' '+type.padEnd(8,' ')+msg;
    if (obj) {
      toRec+= '\n'+self.conv(obj)+'\n'+'-'.repeat(60);
    }
    toRec+= '\n';
    fs.appendFile(fName, toRec, function(e){
      if (e) console.log('Error write file:', e);
    });
  };
  
  this.conv = function(obj, doFormat = true) {
    var cache = [];
    var objStr;
    if (typeof obj === 'object') {
      objStr = JSON.stringify(obj, function(key, value) {
        if (typeof value === 'object' && value !== null) {
          if (cache.includes(value)) return;
          cache.push(value);
        }
        if (key == 'res') {
          return 'BigObject';
        }
        return value;
      }, (doFormat ? '\t' : null));
      cache = null;
    } else return obj;
    return objStr;
  };
  
}

exports.Jalog = Jalog;