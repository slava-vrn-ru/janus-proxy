// The objects for storing client-proxy and proxy-server mappings

function Entities() {
  var self = this;
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
    return ent ? ent.server : undefined;
  };
  this.idGen = function(isSessionId = true) {
    const maxVal = Number.MAX_SAFE_INTEGER;
    const minVal = 1000000000000000;
    var idCandidate;
    do {
      idCandidate = minVal + Math.floor((maxVal - minVal) * Math.random());
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
  this.server = undefined;
  this.room = 0;
  this.isDead = false;
  this.reqCache = [];
}

exports.Entities = Entities;