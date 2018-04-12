const server = require('http').createServer(require('express')());
const io = require('socket.io').listen(server);
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Delete old DB file
fs.stat('./db/main.db', function (err, stats) {
  console.log(stats);

  if(err) {
    return console.error(err);
  }

  fs.unlink('./db/main.db', function(err) {
    if(err) return console.log(err);
    console.log('Old database deleted successfully');
  });
});

var db = new sqlite3.Database('./db/main.db');

db.serialize(function() {

  db.run(`CREATE TABLE if not exists messages (
            message_id integer NOT NULL,
            content blob NOT NULL,
            chat_id integer NOT NULL,
            created_at text NOT NULL)`);

  db.run(`CREATE TABLE if not exists chats (
            chat_id integer NOT NULL,
            sequence_number integer NOT NULL)`);

  db.run(`CREATE TABLE if not exists user_chat (
            user_chat_id integer NOT NULL,
            user_id integer NOT NULL,
            chat_id integer NOT NULL)`);

  db.run(`CREATE TABLE if not exists users (
            user_id integer NOT NULL,
            username string NOT NULL,
            password string NOT NULL,
            first_name string NOT NULL,
            last_name string NOT NULL)`);

  db.run(`CREATE TABLE if not exists keys (
            key_id integer NOT NULL,
            user_id integer NOT NULL,
            public_key blob NOT NULL,
            private_key_enc blob NOT NULL,
            created_at text NOT NULL,
            expired_at text)`);
});

db.close();

server.listen(8080);

io.on('connection', function(socket){
  console.log('a user connected');

  socket.on('disconnect', function(){
    console.log('user disconnected');
  });

  socket.on('msg', function(msg){
    console.log('message: ' + msg);
    io.emit('msg', msg);
  });
});
