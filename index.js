const express = require('express')
const app = express()
const server = require('http').createServer(app);
const io = require('socket.io').listen(server);
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

try {
	fs.unlinkSync('./db/main.db');
	console.log('successfully deleted old database file');
} catch (err) {
	console.log('Could not delete old database file... did it exist?')
}

var db = new sqlite3.Database('./db/main.db');

db.serialize(function() {

	db.run(`CREATE TABLE if not exists messages (
			message_id   INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
			content      BLOB    NOT NULL,
			sender_id    INTEGER NOT NULL,
			recipient_id INTEGER NOT NULL,
			chat_id      INTEGER NOT NULL,
			created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

	db.run(`CREATE TABLE if not exists chats (
			chat_id         INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
			sequence_number INTEGER NOT NULL)`);

	db.run(`CREATE TABLE if not exists user_chat (
			user_chat_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
			user_id      INTEGER NOT NULL,
			chat_id      INTEGER NOT NULL)`);

	db.run(`CREATE TABLE if not exists users (
			user_id    INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
			username   TEXT    NOT NULL,
			password   TEXT    NOT NULL,
			first_name TEXT    NOT NULL,
			last_name  TEXT    NOT NULL)`);

	db.run(`CREATE TABLE if not exists keys (
			key_id          INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
			user_id         INTEGER NOT NULL,
			public_key      BLOB    NOT NULL,
			private_key_enc BLOB    NOT NULL,
			created_at      TEXT    NOT NULL    DEFAULT CURRENT_TIMESTAMP,
			expired_at      TEXT)`);
});

console.log("Database schema written");

// API Endpoints

app.get('/', (req, res) => res.send('Hello World!'))

server.listen(8080);

io.on('connection', function(socket){
	console.log('A user connected');

	socket.on('disconnect', function(){
		console.log('A user disconnected');
	});

	socket.on('msg', function(msg){
		console.log('message: ' + msg);

		db.serialize(function() {
			db.run(`INSERT INTO messages (content, sender_id, recipient_id, chat_id) 
				                  values ("` + msg + `", 1, 2, 1)`);
		});

		io.emit('msg', msg);
	});
});
