// The objects for storing client-proxy and proxy-server mappings

function Entities() {
  var self = this;
  this.servers = [
    { 'url': 'https://janus.kotpusk.ru:8889', 'apiSec': 'XC8xmqcVI5Gcgw3epT0I9CkCQTfZNU4e'},
    { 'url': 'http://34.69.205.108:8880', 'apiSec': '5BVLFa3JWMFKzCNEPABevF7rDxJYvFxVn92X'},
    { 'url': 'http://35.193.110.194:8880', 'apiSec': '5BVLFa3JWMFKzCNEPABevF7rDxJYvFxVn92X'},
                  ];
  this.rooms = [];
  this.entities = [];
  
  // create new entity. First, it empty, exclude 
  this.addEntity = function(idx){
    var newEnt = new Entity(self.idGen(), idx);
    this.entities.push(newEnt);
    return newEnt;
  };
  this.genSenderIDExt = function(idSessionExt) {
    var ent = self.findBySessionIDExt(idSessionExt);
    if (ent) {
      if (ent.idSenderExt) return -1; // idSenderExt already exist, this is a strange situation and should be handled at the top level
      ent.idSenderExt = self.idGen(false);
      return ent;
    } else {
      return 0;
    }
  };
  this.findBySessionIDExt = function(id) {
    return self.entities.find(item => item.idSessionExt == id);
  };
  this.findBySenderIDExt = function(id) {
    return self.entities.find(item => item.idSenderExt == id);
  };
  this.findServerByRoom = function(room) {
    var ent = self.entities.find(item => item.room == room);
    return ent ? { 'srvURL': ent.srvURL, 'srvApiSec': ent.srvApiSec } : 0;
  };
  this.idGen = function(isSessionId = true) {
    const maxVal = Number.MAX_SAFE_INTEGER;
    const minVal = 1000000000000000;
    var idCandidate;
    do {
      idCandidate = minVal + Math.floor((maxVal - minVal) * Math.random());
      /*if (isSessionId) idCandidate = 2936192486478980;
      else idCandidate = 5962896525863409;*/
    } while (isSessionId ? self.findBySessionIDExt(idCandidate) : self.findBySenderIDExt(idCandidate));
    return idCandidate;
  };
}

function Entity(idSessionExt, idx) {
  this.idx = idx;
  this.cntReq = 0;
  this.idSessionExt = idSessionExt;
  this.idSessionInt = 0;
  this.idSenderExt = 0;
  this.idSenderInt = 0;
  this.srvURL = "";
  this.srvApiSec = "";
  this.room = 0;
  this.reqCache = [];
}

exports.Entities = Entities;
//exports.Entity = Entity;