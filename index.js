const express    = require('express')
const app        = express()
const server     = require('http').createServer(app);
const io         = require('socket.io').listen(server);
const sqlite3    = require('sqlite3');
const fs         = require('fs');
const NodeRSA    = require('node-rsa');
const bodyParser = require('body-parser');
const bcrypt     = require('bcrypt');

const bcryptSaltRounds = 10;

var updateUserKeypair = function(u_id, callback) {
	var key = new NodeRSA();
	key.generateKeyPair(1024);
	var public = key.exportKey('public');
	var private = key.exportKey('private');

	db.serialize(function() {
		db.run(`UPDATE keys SET expired_at = datetime('now') WHERE expired_at IS NULL AND user_id = ` + u_id);
		db.run(`INSERT INTO keys (user_id, public_key, private_key_enc) 
			VALUES (` + u_id + `, "` + public + `", "` + private + `")`, callback);
	})
};

var db = new sqlite3.Database('./db/main.db');

// API Endpoints

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, socket_id");
  next();
});

app.use(bodyParser.urlencoded({extended:false}));
app.use(bodyParser.json());

/** kill me now **/
app.get('/loadUserData', function(req, res) {
	var keys, chats, messages, users;
	var u_id = req.query.user_id;

	db.all(`SELECT * FROM keys WHERE user_id = ` + u_id + ` OR expired_at IS NULL`, function(err, data) {
		if(err || !data) return res.status(404).send(err || "No data found for ID");
		keys = data;

		if(req.query.keysonly) {
			return res.send({
				"keys": keys
			});
		}

		db.all(`SELECT * FROM messages WHERE recipient_id = ` + u_id, function(err, data) {
			if(err || !data) return res.status(404).send(err || "No data found for ID");
			messages = data;

			db.all(`SELECT user_id, username, first_name, last_name FROM users`, function(err, data) {
				if(err || !data) return res.status(404).send(err || "No data found for ID");
				users = data

				db.all(`SELECT * FROM chats WHERE chat_id IN (SELECT chat_id FROM user_chat WHERE user_id IS ` + u_id + `)`, function(err, data) {
					if(err || !data) return res.status(404).send(err || "No data found for ID");
					chats = data;
					var chatsProcessed = 0;

					db.serialize(function() {
						for (let chat of chats) {
							db.all(`SELECT user_id, first_name, last_name FROM users WHERE user_id IN 
							(SELECT user_id FROM user_chat WHERE chat_id IS ` + chat.chat_id + `)`, 
							function(err, data) {
								if(err) return res.status(404).send(err);

								chat.members = data;
								chatsProcessed++;
								if(chatsProcessed == chats.length) {
									return res.send({
										"keys": keys,
										"messages": messages,
										"chats": chats,
										"users": users
									});
								}
							});
						};
					});
				});
			});
		});
	});
});

app.post('/login', function(req, res) {
	// Check username validity
	if(!req.body.username || !/^[0-9A-Za-z_\-\.]+$/.test(req.body.username)) {
		return res.status(404).send("username error");
	}

	var username = req.body.username;
	var plaintextPassword = req.body.password;
	db.get(`SELECT * FROM users WHERE username = "` + username + `" LIMIT 1`, function(err, data) {
		if(err) return res.status(404).send("db error");
		if(!data || !data.password) return res.send("no such entry");

		var hash = data.password;
		var u_id = data.user_id;

		bcrypt.compare(plaintextPassword, hash, function(err, valid) {
			if(err) return res.status(404).send("password did not match");

			// When we're here we have successfully logged in
			var socket_id = req.headers.socket_id;
			if(connections[u_id]) {
				connections[u_id].push(socket_id)
			} else {
				connections[u_id] = [socket_id];
			}

			// console.log(connections);

			return res.send({
				success: true,
				user: data
			});
		});
	});
});

app.post('/createUser', function(req, res) {
	if(!req.body.username || !/^[0-9A-Za-z_\-\.]+$/.test(req.body.username)) {
		return res.status(404).send("username error");
	}

	var first = req.body.first.match(/[0-9A-Za-z]+/g).join('');
	var last  =  req.body.last.match(/[0-9A-Za-z]+/g).join('');

	var username = req.body.username;
	var plaintextPassword = req.body.password;

	db.get(`SELECT password FROM users WHERE username = "` + username + `" LIMIT 1`, function(err, data) {
		if(err) return res.send("db error");
		if(data) return res.send("user already exists");

		bcrypt.hash(plaintextPassword, bcryptSaltRounds, function(err, hash) {
			if(err) return res.send("hash error");

			db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES
			("` + username + `", "` + hash + `", "` + first + `", "` + last + `")`, function(err) {
				if(err) return res.status(500).send(err);
				updateUserKeypair(this.lastID, function(err, result) {
					return res.send(true);
				});
			});
		});
	});
});

app.get('/resetDatabase', function(req, res) {
	connections = {};
	db = null;

	try {
		fs.unlinkSync('./db/main.db');
		// console.log('successfully deleted old database file');
	} catch (err) {
		// console.log('Could not delete old database file... did it exist?')
	}

	db = new sqlite3.Database('./db/main.db');

	db.serialize(function() {

		db.run(`CREATE TABLE if not exists messages (
				message_id   INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				content      TEXT    NOT NULL,
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
				expired_at      TEXT	DEFAULT NULL)`);

		db.run(`INSERT INTO chats default values`);
		db.run(`INSERT INTO chats default values`);
		db.run(`INSERT INTO chats default values`);
		db.run(`INSERT INTO chats default values`);

		db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("jameslittle", "$2b$10$poJgedWL57PEMaDHOt/MkuXJmJH4Cw1lfa5MjJitJGcaStEmRqyI2", "James", "Little")`);
		db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("maddie", "$2b$10$poJgedWL57PEMaDHOt/MkuXJmJH4Cw1lfa5MjJitJGcaStEmRqyI2", "Maddie", "Tucker")`);
		db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("danny", "$2b$10$poJgedWL57PEMaDHOt/MkuXJmJH4Cw1lfa5MjJitJGcaStEmRqyI2", "Danny", "Little")`);

		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 1)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 1)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 2)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 2)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 3)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 3)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 4)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 4)`);
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 4)`);
	});

	return res.send(true);
})

server.listen(8080);

console.log("Server started");

var connections = {};

function parseMessage(msg) {
	var version = msg.substring(0, 4);
	var type, len, seq_num, snd, rcv, cht, timestamp;

	if(version == "0001") {
		type = msg.substring(4, 6);
		len = parseInt(msg.substring(6, 14), 16);
		seq_num = parseInt(msg.substring(14, 22), 16);
		snd = parseInt(msg.substring(22, 26), 16);
		rcv = parseInt(msg.substring(26, 30), 16);
		cht = parseInt(msg.substring(30, 34), 16);
		timestamp = parseInt(msg.substring(34, 46), 16);
	}

	return {
		type: type,
		len: len,
		seq_num: seq_num,
		snd: snd,
		rcv: rcv,
		cht: cht,
		timestamp: timestamp,
		content: msg
	};
}

io.on('connection', function(socket){
	// console.log('Connection ' + socket.id + ' began');

	socket.on('disconnect', function(){
		// console.log('Connection ' + socket.id + ' ended :(');
		for(user_id in connections) {
			if (connections[user_id].indexOf(socket.id) != -1) {
				connections[user_id].splice(connections[user_id].indexOf(socket.id), 1);
				if(connections[user_id].length == 0) {
					delete connections[user_id];
					break;
				}
			}
		}
		// console.log(connections);
	});

	socket.on('msg', function(msg){
		if(!/^[0-9a-fA-F]+$/.test(msg)) {
			return;
		}

		// console.log('message: ' + msg);

		msg = parseMessage(msg);

		db.serialize(function() {
			db.run(`INSERT INTO messages (content, sender_id, recipient_id, chat_id) 
								  values ("` + msg.content + `", ` + msg.snd + `, ` + msg.rcv + `, ` + msg.cht + `)`);
		});

		// console.log(connections);

		if(connections[msg.rcv]) {
			// console.log(connections[msg.rcv].length)

			for(var i=0; i<connections[msg.rcv].length; i++) {
				var socketid = connections[msg.rcv][i];
				// console.log("Sending message to socketid", socketid);
				io.to(socketid).emit('msg', msg.content);
			}
		}
	});

	socket.on('key-submit', function(data) {
		let s_id = data.socket_id;
		let u_id = data.user_id;
		let public = data.key.public;
		let private = data.key.private;

		// console.log("Inserting public key", public);

		db.serialize(function() {
			db.run(`UPDATE keys SET expired_at = datetime('now') WHERE expired_at IS NULL AND user_id = ` + u_id);
			db.run(`INSERT INTO keys (user_id, public_key, private_key_enc) 
				VALUES (` + u_id + `, "` + public + `", "` + private + `")`, function() {
					io.to(s_id).emit('key-response', {success: true});
					socket.broadcast.emit('key-reload', {success: true});
				});
		});
	})
});
