const express = require('express')
const app = express()
const server = require('http').createServer(app);
const io = require('socket.io').listen(server);
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const NodeRSA = require('node-rsa');

var generateKeys = function() {
	var key = new NodeRSA();
	key.generateKeyPair(1024);
	var public = key.exportKey('public');
	var private = key.exportKey('private');

	return {"pri": private, "pub": public};
};

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
			sequence_number INTEGER DEFAULT 0   NOT NULL)`);

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

	db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("james", "", "James", "Little")`);
	db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("maddie", "", "Maddie", "Tucker")`);
	db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("danny", "", "Danny", "Little")`);

	var keys = generateKeys();
	db.run(`INSERT INTO keys (user_id, public_key, private_key_enc) VALUES (1, "` + keys.pub + `", "` + keys.pri + `")`)

	keys = generateKeys();
	db.run(`INSERT INTO keys (user_id, public_key, private_key_enc) VALUES (2, "` + keys.pub + `", "` + keys.pri + `")`)

	keys = generateKeys();
	db.run(`INSERT INTO keys (user_id, public_key, private_key_enc) VALUES (3, "` + keys.pub + `", "` + keys.pri + `")`)

	db.run(`INSERT INTO chats default values`);
	db.run(`INSERT INTO chats default values`);
	db.run(`INSERT INTO chats default values`);
	db.run(`INSERT INTO chats default values`);

	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 1)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 1)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 2)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 2)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 3)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 3)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 4)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 4)`);
	db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 4)`);

	db.all(`SELECT * FROM chats`, function(err, data) {
		console.log(data);
	});
});

// API Endpoints

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get('/messages', function (req, res) {
	if(!req.query.recipient || !/^\d+$/.test(req.query.recipient)) {
		res.send("recipient error");
		return;
	}

	var r_id = req.query.recipient;
	db.all(`SELECT * FROM messages WHERE recipient_id = ` + r_id, function(err, data) {
		if(!err) {
			res.send(data);
			return;
		}
	});
});

app.get('/users', function(req, res) {
	db.all(`SELECT * FROM users`, function(err, data) {
		if(!err) {
			res.send(data);
			return;
		}
	});
});

app.get('/chats', function(req, res) {
	if(!req.query.user_id || !/^\d+$/.test(req.query.user_id)) {
		res.send("user id error");
		return;
	}

	var chats = [];

	var u_id = req.query.user_id;
	db.serialize(function() {
		db.all(`SELECT * FROM chats WHERE chat_id IN (SELECT chat_id FROM user_chat WHERE user_id IS ` + u_id + `)`, function(err, data) {
			if(err) {
				res.send(err);
				return;
			}

			chats = data;

			db.serialize(function() {
				var chatsProcessed = 0;
				for (let chat of chats) {
					db.all(`SELECT user_id, first_name, last_name FROM users WHERE user_id IN (SELECT user_id FROM user_chat WHERE chat_id IS ` + chat.chat_id + `)`, function(err, data) {
						if(err) {
							res.send(err);
							return;
						}

						chat.members = data;
						chatsProcessed++;
						if(chatsProcessed == chats.length) {
							res.send(chats);
							return;
						}
					});
				};
			});
		});
	});

	// res.send(chats);
	// return;
});

app.get('/publicKey', function(req, res) {
	if(!req.query.user_id || !/^\d+$/.test(req.query.user_id)) {
		res.send("user id error");
		return;
	}

	var u_id = req.query.user_id;
	db.get(`SELECT public_key FROM keys WHERE user_id = ` + u_id + ` LIMIT 1`, function(err, data) {
		if(!err) {
			res.send(data.public_key);
			return;
		}
	});
});

app.get('/privateKey', function(req, res) {
	if(!req.query.user_id || !/^\d+$/.test(req.query.user_id)) {
		res.send("user id error");
		return;
	}

	var u_id = req.query.user_id;
	db.get(`SELECT private_key_enc FROM keys WHERE user_id = ` + u_id + ` LIMIT 1`, function(err, data) {
		if(!err) {
			res.send(data.private_key_enc);
			return;
		}
	});
});

server.listen(8080);

io.on('connection', function(socket){
	console.log('Connection ' + socket.id + ' began');

	socket.on('disconnect', function(){
		console.log('Connection ' + socket.id + ' ended');
	});

	socket.on('msg', function(msg){
		if(!/^[0-9a-fA-F]+$/.test(msg)) {
			return;
		}

		console.log('message: ' + msg);

		db.serialize(function() {
			db.run(`INSERT INTO messages (content, sender_id, recipient_id, chat_id) 
				                  values ("` + msg + `", 1, 2, 1)`);
		});

		io.emit('msg', msg);
	});
});
