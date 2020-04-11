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
rt.use('/janus', rtMain);
rt.use(rtUnrouted);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(rt);

https.createServer(httpsOpts, app).listen(8889, function(){
  console.log('proxy listen 8889');
});

function rtMain(req, res, next) {
  console.log('JANUS: %s %s\n', req.method, req.url, req.body);
  if (!checkRequest(req.body)) {
    res.json({'error':'wrong request'});
    return;
  }
  let jAct = req.body.janus;
  if (jAct == 'create') {
    var newEnt = entityCreate(entities);
    res.json({"janus": "success", "transaction": "Transaction", "data": { "id": newEnt[pnIdSessIntrn] }});
  } else if (jAct == 'attach') {
    res.json({'action':'attach'});
  } else {
    console.log(('Unhandled action: %s').red, jAct, req.body);
    res.json({'error':'unhandled action'});
  }
}
function rtUnrouted(req, res, next) {
  console.log(('Unhandled path: %s %s\n').red, req.method, req.url, req.body);
  res.json({'error':'wrong path'});
}
function rtLog(req, res, next) {
  console.log(('Req: %s %s').gray, req.method, req.url);
  next();
}

function checkRequest(strReq) {
  if (!strReq['apisecret']) return false;
  return (strReq['janus']=='create' && strReq['transaction']=='Transaction');
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
