/*jshint -W069 */

var colors = require('colors');
var fs = require('fs');
var axios = require('axios');
var https = require('https');
var jalog = require('./jalog.js');

var httpsOpts = {
  key: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/cert.pem'),
};

function textTime() {
  var d = new Date();
  //return d.getDate().padStart(2, '0')+' '+d.getHours().padStart(2, '0')+':'+d.getMinutes().padStart(2, '0')+':'+
  //      d.getSeconds().padStart(2, '0')+':'+d.getMilliseconds().padStart(2, '0');
  return d.toISOString();
}

var httpsAgent = new https.Agent(httpsOpts);

function Logic(entities) {
  var self = this;
  this.entities = entities;
  this.jalog = new jalog.Jalog();
  this.cntCreate = 0;
  
  // Main client request processor
  // If the beginning of a new session is detected (Create and Attach requests), the response to the request is generates independently,
  // without actually sending the request to the Janus server. All other requests are cached until a Message request with a room number is received.
  // Upon receiving the room number in the Message request, the Janus server is selected and a connection is established with it,
  // after which all cached requests are sent
  this.rtMain = function(req, res) {
    var idSessionExt = req.params['idSession'];
    var idSenderExt = req.params['idSender'];
    var jAct = req.body['janus'];
    var entity;
    switch (jAct) {
      case 'create':
        ++self.cntCreate;
        console.log(colors.yellow('%s received Create #%d'), textTime(), self.cntCreate);
        self.jalog.log(self.cntCreate, 'cl->pr', 'received Create');
        if (!self.checkReqCreate(req.body)) { self.actErrWrongReq(req, res); return; }
        // TODO: req.body['apisecret'] must checked
        entity = self.actCreate(self.cntCreate);
        self.actResponseCreate(res, entity);
        break;
      case 'attach':
        console.log(colors.yellow('%s received Attach (SessionExt: %s)'), textTime(), idSessionExt);
        if (!self.checkReqAttach(req.body, idSessionExt)) { self.actErrWrongReq(req, res); return; }
        entity = self.actAttach(idSessionExt);
        if (entity === -1) { self.actErrWrongReq(req, res, "idSenderExt already exist!"); return; }
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.jalog.log(entity.idx, 'cl->pr', 'received Attach');
        self.actResponseAttach(res, entity);
        break;
      case 'message':
        console.log(colors.yellow('%s received Message: '+req.body['body']['request']+' (SessionExt: %s; SenderExt: %s)'), textTime(), idSessionExt, idSenderExt);
        if (!self.checkReqMessage(req.body, idSessionExt, idSenderExt)) { self.actErrWrongReq(req, res); return; }
        entity = self.entities.findBySenderIDExt(idSenderExt);
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.jalog.log(entity.idx, 'cl->pr', 'received Message:\n'+req.body+'-'.repeat(60));
        if (!entity.room && (req.body['body']['request'] == 'listparticipants' || req.body['body']['request'] == 'exists')) {
          var room = req.body['body']['room'];
          var server = self.entities.findServerByRoom(room);
          if (!server) server = self.serverChoose();
          self.jalog.log(entity.idx, 'info  ', 'Server selected: '+server.srvURL);
          self.jalog.log(entity.idx, 'info  ', 'Start server interact');
          self.actStartServerInteract(entity, server, room);
        }
        self.actProcessReq(entity, req.method, idSessionExt, idSenderExt, req.body, req.query, res);
        break;
      default:
        console.log(colors.yellow('%s received request %s (SessionExt: %s; SenderExt: %s)'), textTime(), jAct, idSessionExt, idSenderExt);
        if (!idSessionExt) { self.actErrWrongReq(req, res); return; }
        entity = self.entities.findBySessionIDExt(idSessionExt);
        if (!entity) { self.actErrWrongReq(req, res, "entity not found!"); return; }
        self.jalog.log(entity.idx, 'cl->pr', 'received request:('+req.method+')\n'+(req.method=='GET'?req.query:req.body)+'\n'+'-'.repeat(60));
        self.actProcessReq(entity, req.method, idSessionExt, idSenderExt, req.body, req.query, res);
    }
  };
  
  // Generating of response to the client for the Create request
  this.actResponseCreate = function(res, entity) {
    console.log(colors.yellow('%s answered Create #%d (SessionExt: %d)'), textTime(), entity.idx, entity.idSessionExt);
    self.jalog.log(entity.idx, 'cl<-pr', 'sent Create');
    res.json({"janus": "success", "transaction": "Transaction", "data": { "id": entity.idSessionExt }});
  };
  // Generating of response to the client for the Attach request
  this.actResponseAttach = function(res, entity) {
    console.log(colors.yellow('%s answered Attach #%d (SessionExt: %d; SenderExt: %d)'), textTime(), entity.idx, entity.idSessionExt, entity.idSenderExt);
    self.jalog.log(entity.idx, 'cl<-pr', 'sent Attach');
    res.json({"janus": "success", "session_id": entity.idSessionExt, "transaction": "Transaction", "data": { "id": entity.idSenderExt }});
  };
  
  // Functions for checking requests parameters
  // TODO: I don't check the 'apisecret' value in these functions
  this.checkReqCreate = function(strReq) {
    return strReq['janus']=='create' && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  this.checkReqAttach = function(strReq, idSessionExt) {
    return strReq['janus']=='attach' && idSessionExt && strReq['plugin']=='janus.plugin.videoroom' && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  this.checkReqMessage = function(strReq, idSessionExt, idSenderExt) {
    return strReq['janus']=='message' && idSessionExt && idSenderExt && strReq['body'] && strReq['transaction']=='Transaction' && strReq['apisecret'];
  };
  
  // Server selection function
  this.serverChoose = function() {
    //return 'https://janus.kotpusk.ru:8889';
    var server = self.entities.servers.shift();
    self.entities.servers.push(server);
    var srv = { 'srvURL': server.url, 'srvApiSec': server.apiSec };
    console.log(colors.yellow('Server selected: ', server.url));
    return srv;
  };
  
  // Generating a response to a client in case of an erroneous request
  // TODO: It's necessary to remake the answer in the correct format with emulation of the answer Janus server
  this.actErrWrongReq = function(req, res, text = "") {
    if (!text) text = "\n"+text;
    console.log(colors.red('Wrong request: %s %s%s\n'), req.method, req.url, text, req.body);
    console.log('-'.repeat(60));
    res.json({'error':'wrong request'});
  };
  // Adding a new client-server mapping entry (apisecret is required)
  this.actCreate = function(idx) {
    return self.entities.addEntity(idx);
  };
  // Generating a SenderID for an existing client-server mapping entry
  this.actAttach = function(idSessionExt) {
    return self.entities.genSenderIDExt(idSessionExt);
  };
  
  // Client request processing function
  // If the procedure for establishing communication with the Janus server has not yet been performed, the request is cached
  // Otherwise, we immediately redirect the request to the Janus server with the replacement of SessionID and SenderID,
  // and assign a callback function that sends a response to the client
  this.actProcessReq = function(entity, reqMethod, idSessionExt, idSenderExt, reqBody, reqQuery, res) {
    if (entity.srvURL && entity.idSessionInt && entity.idSenderInt) {
      var locCntReq = ++entity.cntReq;
      var url = entity.srvURL+'/janus';
      if (idSessionExt) url = url + '/' + entity.idSessionInt;
      if (idSenderExt) url = url + '/' + entity.idSenderInt;
      if ('apisecret' in reqBody) reqBody['apisecret'] = entity.srvApiSec;
      console.log(colors.yellow('request #%d.%d proxying to %s: (%s) idSessionExt: %s; idSenderExt: %s'), entity.idx, locCntReq, entity.srvURL, reqMethod, idSessionExt, idSenderExt);
      console.log('DATA: ', reqBody);
      console.log('QUERY: ', reqQuery);
      console.log('-'.repeat(60));
      self.jalog.log(entity.idx, 'pr->sr', 'sending request #'+locCntReq+':('+reqMethod+')\n'+(reqMethod=='GET'?reqQuery:reqBody)+'\n'+'-'.repeat(60));
      switch (reqMethod) {
        case 'POST':
          axios.post(url, reqBody, httpsAgent)
            .then(function (respJanus) {
              if (respJanus.data.session_id) respJanus.data.session_id = entity.idSessionExt;
              if (respJanus.data.sender) respJanus.data.sender = entity.idSenderExt;
              console.log(colors.yellow('response #%d.%d proxying from %s'), entity.idx, locCntReq, entity.srvURL);
              console.log(respJanus.toString());
              console.log('-'.repeat(60));
              self.jalog.log(entity.idx, 'sr->pr', 'resp to request #'+locCntReq+':('+reqMethod+')\n'+respJanus.toString()+'\n'+'-'.repeat(60));
              res.json(respJanus.data);
            }).catch(function (error) {
              console.log(colors.red('Error communicate server'));
              console.log(colors.red(error.response));
            });
          break;
        case 'GET':
          axios.get(url, {'params': reqQuery}, httpsAgent)
            .then(function (respJanus) {
              if (respJanus.data.session_id) respJanus.data.session_id = entity.idSessionExt;
              if (respJanus.data.sender) respJanus.data.sender = entity.idSenderExt;
              console.log(colors.yellow('response #%d.%d proxying from %s'), entity.idx, locCntReq, entity.srvURL);
              console.log(respJanus.toString());
              console.log('-'.repeat(60));
              self.jalog.log(entity.idx, 'sr->pr', 'resp to request #'+locCntReq+':('+reqMethod+')\n'+respJanus.toString()+'\n'+'-'.repeat(60));
              res.json(respJanus.data);
            }).catch(function (error) {
              console.log(colors.red('Error communicate server'));
              console.log(colors.red(error.response));
            });
          break;
        default: 
      }
    } else {
      console.log(colors.yellow('request caching: (%s) idSessionExt: %s; idSenderExt: %s'), reqMethod, idSessionExt, idSenderExt);
      console.log('DATA: ', reqBody);
      console.log('QUERY: ', reqQuery);
      console.log('-'.repeat(60));
      self.jalog.log(entity.idx, 'cache ', 'received request:('+reqMethod+')\n'+(reqMethod=='GET'?reqQuery:reqBody)+'\n'+'-'.repeat(60));
      var reqData = {"reqMethod": reqMethod, "idSessionExt": idSessionExt, "idSenderExt": idSenderExt, "reqBody": reqBody, "reqQuery": reqQuery, "res": res};
      entity.reqCache.push(reqData);
    }
  };
  
  // Sending accumulated client requests to the Janus server
  this.actProcessCacheReq = function(entity) {
    console.log(colors.yellow('%s cache process start #%d'), textTime(), entity.idx);
    self.jalog.log(entity.idx, 'info  ', 'Start process cache');
    while (entity.reqCache.length) {
      cachedReq = entity.reqCache.shift();
      self.actProcessReq(entity, cachedReq["reqMethod"], cachedReq["idSessionExt"], cachedReq["idSenderExt"], cachedReq["reqBody"], cachedReq["reqQuery"], cachedReq["res"]);
    }
    console.log(colors.yellow('%s cache process finish #%d'), textTime(), entity.idx);
  };
  
  // Real interaction with the Janus server after receiving the room number from the client and selecting the Janus server
  // After receiving session identifiers from the Janus server, we must send the accumulated client requests to the Janus server
  this.actStartServerInteract = function(entity, server, room) {
    entity.srvURL = server.srvURL;
    entity.srvApiSec = server.srvApiSec;
    entity.room = room;
    var msgCreate = {"janus": "create", "transaction": "Transaction", "apisecret": entity.srvApiSec};
    console.log(colors.yellow('%s Srv send Create #%d (SessionExt: %d; SenderExt: %d) to %s'),
                textTime(), entity.idx, entity.idSessionExt, entity.idSenderExt, entity.srvURL);
    console.log(msgCreate);
    console.log('+'.repeat(60));
    axios.post(entity.srvURL+'/janus', msgCreate, httpsAgent)
      .then(function (respCreate) {
        try {
          idSessionInt = respCreate.data.data.id;
        } catch(e) {
          console.log(colors.red(e));
          idSessionInt = 0;
        }
        console.log(colors.yellow('%s Srv resp Create #%d (SessionExt->SessionInt: %d->%d) from %s'), textTime(), entity.idx, entity.idSessionExt, idSessionInt, entity.srvURL);
        console.log(respCreate.data);
        console.log('+'.repeat(60));
        // TODO: check response and process possible errors
        entity.idSessionInt = idSessionInt;
        var msgAttach = {"janus": "attach", "plugin": "janus.plugin.videoroom", "transaction": "Transaction", "apisecret": entity.srvApiSec};
        console.log(colors.yellow('%s Srv send Attach #%d (SessionExt: %d; SenderExt: %d) to %s'), textTime(), entity.idx, entity.idSessionExt, entity.idSenderExt, entity.srvURL);
        console.log(msgAttach);
        console.log('+'.repeat(60));
        axios.post(entity.srvURL+'/janus/'+idSessionInt, msgAttach, httpsAgent)
          .then(function (respAttach) {
            try {
              idSenderInt = respAttach.data.data.id;
            } catch(e) {
              console.log(colors.red(e));
              idSenderInt = 0;
            }
            console.log(colors.yellow('%s Srv resp Attach #%d (SenderExt->SenderInt: %d->%d) from %s'), textTime(), entity.idx, entity.idSenderExt, idSenderInt, entity.srvURL);
            console.log(respAttach.data);
            console.log('+'.repeat(60));
            // TODO: check response and process possible errors
            entity.idSenderInt = idSenderInt;
            console.log('-- Entity #%d data --', entity.idx);
            console.log(entity);
            console.log('-'.repeat(60));
            self.jalog.log(entity.idx, 'info  ', 'Entity formed:\n'+entity.toString()+'\n'+'-'.repeat(60));
            self.actProcessCacheReq(entity);
          }).catch(function (error) {
            console.log(colors.red('Error communicate server: attach phase'));
            console.log(colors.red(error));
          });
      }).catch(function (error) {
        console.log(colors.red('Error communicate server: create phase'));
        console.log(colors.red(error));
      });
  };
  
  this.rtUnrouted = function(req, res) {
    console.log(colors.red('Unhandled path: %s %s\n'), req.method, req.url, req.body);
    res.json({'error':'wrong path'});
  };
  this.rtLog = function(req, res, next) {
    var sTime = textTime();
    console.log(colors.gray('%s ---- Log client request ----------------------------'), sTime);
    console.log(colors.gray('Req: %s %s\n'), req.method, req.url, req.body);
    console.log(colors.gray('-'.repeat(sTime.length+53)));
    next();
  };
  
  this.rtService = function(req, res) {
    console.log('-- All Entity data --');
    console.log(self.entities);
    console.log('-'.repeat(60));
    res.json({"result": "success"});
  };
}

exports.Logic = Logic;