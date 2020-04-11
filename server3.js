/*jshint -W069 */
var https = require('https'),
    fs = require('fs'),
    colors = require('colors'),
    express = require('express'),
    bodyParser = require('body-parser');

var httpsOpts = {
  key: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/proxy.kotpusk.ru/cert.pem'),
};

const pnIdSessIntrn = 'idSessIntrn',
      pnIdSndrIntrn = 'idSndrIntrn';

var entities = [];

var app = express();
var rt = express.Router();

rt.use(rtLog);
rt.use('/janus/:idSession/:idSender', rtMain);
rt.use('/janus/:idSession', rtMain);
rt.use('/janus', rtMain);
rt.use(rtUnrouted);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(rt);

https.createServer(httpsOpts, app).listen(8889, function(){
  console.log('proxy listen 8889');
});

function rtMain(req, res) {
  console.log('JANUS: %s %s\n', req.method, req.url, req.body);
  if (!checkRequest(req.body, req.params)) {
    console.log(('Wrong request\n').red, req.body);
    res.json({'error':'wrong request'});
    return;
  }
  let jAct = req.body['janus'];
  if (jAct == 'create') {
    let newEnt = entityCreate(entities, req.body['apisecret']);
    res.json({"janus": "success", "transaction": "Transaction", "data": { "id": newEnt[pnIdSessIntrn] }});
  } else if (jAct == 'attach') {
    console.log(req.params.yellow);
    let exEnt = entityFind(entities, pnIdSessIntrn, req.params['idSession']);
    if (exEnt) {
      exEnt[pnIdSndrIntrn] = idGen(entities, false);
      res.json({"janus": "success", "session_id": req.params['idSession'], "transaction": "Transaction", "data": { "id": exEnt[pnIdSndrIntrn] }});
    } else {
      console.log(('Session not found\n').red, req.body);
      res.json({'error':'session not found'});
    }
  } else if (jAct == 'message') {
    console.log(req.params.yellow);
    let exEnt = entityFind(entities, pnIdSndrIntrn, req.params['idSender']);
    if (exEnt) {
      
    } else {
      console.log(('Sender not found\n').red, req.body);
      res.json({'error':'sender not found'});
    }
  } else {
    console.log(('Unhandled action: %s').red, jAct, req.body);
    res.json({'error':'unhandled action'});
  }
}
function rtUnrouted(req, res) {
  console.log(('Unhandled path: %s %s\n').red, req.method, req.url, req.body);
  res.json({'error':'wrong path'});
}
function rtLog(req, res, next) {
  console.log(('Req: %s %s').gray, req.method, req.url);
  next();
}

function checkRequest(strReq, aReqParams) {
  if (!strReq['apisecret']) return false;
  return (strReq['janus']=='create' && strReq['transaction']=='Transaction') ||
         (strReq['janus']=='attach' && aReqParams['idSession'] && strReq['plugin']=='janus.plugin.videoroom' && strReq['transaction']=='Transaction') ||
         (strReq['janus']=='message' && aReqParams['idSession'] && aReqParams['idSender'] && strReq['body'] && strReq['transaction']=='Transaction');
}

function entityCreate(aEntity, apiSec) {
  var newEntity = {};
  newEntity[pnIdSessIntrn] = idGen(aEntity);
  newEntity['apisecret'] = apiSec;
  aEntity.push(newEntity);
  return newEntity;
}
function entityFind(aEntity, key, value) {
  return aEntity.find(item => item[key] == value);
}
function idGen(aEntity, isSessionId = true) {
  var propName = isSessionId ? pnIdSessIntrn : pnIdSndrIntrn;
  const maxVal = Number.MAX_SAFE_INTEGER;
  const minVal = 1000000000000000;
  var idCandidate;
  do {
    idCandidate = minVal + Math.floor((maxVal - minVal) * Math.random());
  } while (entityFind(aEntity, propName, idCandidate));
  return idCandidate;
}
