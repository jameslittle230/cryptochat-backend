const express    = require('express')
const app        = express()
const server     = require('http').createServer(app);
const io         = require('socket.io').listen(server);
const sqlite     = require('sqlite');
const fs         = require('fs');
const NodeRSA    = require('node-rsa');
const bodyParser = require('body-parser');
const bcrypt     = require('bcrypt');

const bcryptSaltRounds = 10;

var db;

/** Config **/

function configApp(app) {
	app.use(bodyParser.urlencoded({extended:false}));
	app.use(bodyParser.json());

	app.use(function(req, res, next) {
		res.header("Access-Control-Allow-Origin", "*");
		res.header("Access-Control-Allow-Headers", `Origin, X-Requested-With, Content-Type, Accept, socket_id`);
		next();
	});
}

configApp(app);

/** Connections Store **/

var connections = {};

function addToConnections(user_id, socket_id) {
	if (connections[user_id]) {
		connections[user_id].push(socket_id);
	} else {
		connections[user_id] = [socket_id];
	}
}

function removeFromConnections(socket_id) {
	for(user_id in connections) {
		if (connections[user_id].indexOf(socket_id) != -1) {
			connections[user_id].splice(connections[user_id].indexOf(socket_id), 1);
			if(connections[user_id].length == 0) {
				delete connections[user_id];
				break;
			}
			return user_id
		}
	}
}

/** Get Data **/

async function getAllUsers() {
	const users = await db.all(`SELECT user_id, username, first_name, last_name FROM users`);
	return users;
}

async function getKeysForUser(user_id) {
	const keys = await db.all(`SELECT * FROM keys WHERE user_id = ? OR expired_at IS NULL`, [user_id]);
	return keys;
}

async function getMessagesForUser(user_id) {
	const messages = await db.all(`SELECT * FROM messages WHERE recipient_id = ?`, [user_id]);
	return messages;
}

async function getChatsForUser(user_id) {
	try {
		var chats = await db.all(`SELECT * FROM chats WHERE chat_id IN 
			(SELECT chat_id FROM user_chat WHERE user_id IS ?)`, [user_id]);

		for (let chat of chats) {
			const members = await db.all(`SELECT user_id, first_name, last_name FROM users WHERE user_id IN 
				(SELECT user_id FROM user_chat WHERE chat_id IS ?)`, [chat.chat_id]);

			chat.members = members;
		}

		return chats;
	} catch(error) {
		return error;
	}
}

/** Update Keypair **/

async function updateKeypair(user_id, key) {
	await db.run(`UPDATE keys SET expired_at = datetime('now') WHERE expired_at IS NULL AND user_id = ?`, [user_id]);
	await db.run(`INSERT INTO keys (user_id, public_key, private_key_enc) VALUES (?, ?, ?)`, [user_id, key.public, key.private]);
	io.of('/').emit('key-reload', {success: true});
}

/** Handle Disconnect **/

function handleDisconnect(socket_id) {
	const user_id = removeFromConnections(socket_id);
	if(!connections[user_id]) {
		io.of('/').emit('user-disconnect', user_id);
	}
}

/** Handle Message **/

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

function messageNotHexadecimalException() {
	return {
		error: true,
		message: "Incoming message not of hexadecimal format."
	}
}

async function handleMessage(msg, sender_socket_id) {
	try {
		if(!/^[0-9a-fA-F]+$/.test(msg)) {
			throw new messageNotHexadecimalException();
		}

		msg = parseMessage(msg);

		await db.run(`INSERT INTO messages (content, sender_id, recipient_id, chat_id) values (?, ?, ?, ?)`, 
			[msg.content, msg.snd, msg.rcv, msg.cht]);

		if(connections[msg.rcv]) {
			for(var i=0; i<connections[msg.rcv].length; i++) {
				var socketid = connections[msg.rcv][i];
				io.to(socketid).emit('msg', msg.content);
			}
		}
	} catch(error) {
		io.to(sender_socket_id).emit('msg-error', error);
	}
} 

/** Request Parameter Testing **/

function requestParameterDoesNotExistException() {
	return {
		error: true,
		message: "Required parameter does not exist in HTTP request."
	}
}

function requestParameterFormatException(param) {
	return {
		error: true,
		message: "Parameter " + param + " does not conform to necessary format."
	}
}

function testRequestParameter(param, regex = /(.*?)/) {	
	if(!param) {
		throw new requestParameterDoesNotExistException()
	}
	if(!regex.test(param)) {
		throw new requestParameterFormatException(param)
	}

	return true;
}

/** Authentication Testing **/

/** 
 * I'm disabling authentication for now, since the implementation is unreliable and the
 * point of the assignment isn't user authentication between sockets and HTTP.
 */

function userNotAuthenticatedError() {
	return {
		error: true,
		message: "Trying to access data from a socket that doesn't match connection data"
	}
}

function authenticateUser(user_id, req) {
	// if(!connections[user_id] || !req.headers.socket_id in connections[user_id]) {
	// 	throw new userNotAuthenticatedError();
	// }

	return true;
}

/** Login Endpoint **/

function loginPasswordMismatchException() {
	return {
		error: true,
		message: "Password does not match stored records."
	}
}

function loginUserDoesNotExistException(username) {
	return {
		error: true,
		message: "Username " + username + " does not exist in database."
	}
}

app.post('/login', async function(req, res) {
	// Check username validity
	try { 
		testRequestParameter(req.body.username, /^[0-9A-Za-z_\-\.]+$/);
		testRequestParameter(req.body.password);
		testRequestParameter(req.body.key);
	}
	catch(e) {return res.status(400).send(e) }

	var username = req.body.username;
	var plaintextPassword = req.body.password;
	var key = req.body.key;

	try {
		const data = await db.get(`SELECT * FROM users WHERE username = ? LIMIT 1`, [username]);

		const match = await bcrypt.compare(plaintextPassword, data.password);
		if(!match) throw new loginPasswordMismatchException()

		await updateKeypair(data.user_id, key);

		addToConnections(data.user_id, req.headers.socket_id);

		if(connections[data.user_id].length == 1) {
			io.of('/').emit('user-connect', data.user_id);
		}

		return res.send({
			success: true,
			user: data
		});

	} catch(error) {
		console.log(error)
		return res.status(400).send(error);
	}
});

/** Register Endpoint **/

function registerUserAlreadyExistsException(username) {
	return {
		error: true,
		message: "Username " + username + " already exists in database."
	}
}

app.post('/register', async function(req, res) {
	try { 
		testRequestParameter(req.body.username, /^[0-9A-Za-z_\-\.]+$/);
		testRequestParameter(req.body.password, /.{8,}/);
		testRequestParameter(req.body.first, /^[0-9A-Za-z]+$/);
		testRequestParameter(req.body.last, /^[0-9A-Za-z]+$/);
		testRequestParameter(req.body.key);
	} 
	catch(e) {return res.status(400).send(e) }

	var username = req.body.username;
	var plaintextPassword = req.body.password;
	var first = req.body.first;
	var last = req.body.last;
	var key = req.body.key;

	try {
		const userSearchData = await db.get(`SELECT password FROM users WHERE username = ? LIMIT 1`, [username]);
		if(userSearchData) throw new registerUserAlreadyExistsException(username);

		const passwordHash = await bcrypt.hash(plaintextPassword, bcryptSaltRounds);

		const newUser = await db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES (?, ?, ?, ?)`, [username, passwordHash, first, last]);
		
		await updateKeypair(newUser.lastID, key);

		addToConnections(newUser.lastID, req.headers.socket_id);
		
		const singleUserData = await db.get(`SELECT * FROM users WHERE user_id = ? LIMIT 1`, [newUser.lastID]);
		const allUsersData = await getAllUsers();

		io.of('/').emit('user-reload');

		return res.send({
			success: true,
			user: singleUserData
		});
	} catch(error) {
		return res.status(400).send(error);
	}
});

/** New Chat Endpoint **/

app.post('/newChat', async function(req, res) {
	testRequestParameter(req.query.user_id, /^[0-9]+$/);
	testRequestParameter(req.query.members);
	const user_id = req.query.user_id;
	authenticateUser(req.query.user_id, req);

	const members = req.query.members

	const newChat = await db.run(`INSERT INTO chats DEFAULT VALUES`);
	const chat_id = newChat.lastID;

	for(let member_id in members) {
		await db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (?, ?)`, [member_id, chat_id]);
	}

	io.of('/').emit('chat-reload');
});

/** Load Data Endpoint **/

app.get('/loadData', async function(req, res) {
	try {
		testRequestParameter(req.query.user_id, /^[0-9]+$/);
		const user_id = req.query.user_id;
		authenticateUser(req.query.user_id, req);

		var output = {}

		var noInputsSpecified = !req.query.keys && !req.query.chats && !req.query.messages && !req.query.users;

		if(req.query.keys || noInputsSpecified)     output["keys"]     = await getKeysForUser(user_id);
		if(req.query.chats || noInputsSpecified)    output["chats"]    = await getChatsForUser(user_id);
		if(req.query.messages || noInputsSpecified) output["messages"] = await getMessagesForUser(user_id);
		if(req.query.users || noInputsSpecified)    output["users"]    = await getAllUsers();

		return res.send({
			success: true,
			data: output
		});
	} catch(error) {
		console.log(error);
		return res.status(400).send(error);
	}
});

/** Reset Database **/
app.get('/resetDatabase', async function(req, res) {
	connections = {};
	db = null;

	try {
		fs.unlinkSync('./db/main.db');
	} catch (err) {console.log('Couldn\'t delete old database')}

	db = await sqlite.open('./db/main.db', { Promise });

	await Promise.all([
		db.run(`CREATE TABLE if not exists messages (
				message_id   INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				content      TEXT    NOT NULL,
				sender_id    INTEGER NOT NULL,
				recipient_id INTEGER NOT NULL,
				chat_id      INTEGER NOT NULL,
				created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP)`),

		db.run(`CREATE TABLE if not exists chats (
				chat_id         INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				sequence_number INTEGER DEFAULT 0   NOT NULL)`),

		db.run(`CREATE TABLE if not exists user_chat (
				user_chat_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				user_id      INTEGER NOT NULL,
				chat_id      INTEGER NOT NULL)`),

		db.run(`CREATE TABLE if not exists users (
				user_id    INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				username   TEXT    NOT NULL,
				password   TEXT    NOT NULL,
				first_name TEXT    NOT NULL,
				last_name  TEXT    NOT NULL)`),

		db.run(`CREATE TABLE if not exists keys (
				key_id          INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
				user_id         INTEGER NOT NULL,
				public_key      BLOB    NOT NULL,
				private_key_enc BLOB    NOT NULL,
				created_at      TEXT    NOT NULL    DEFAULT CURRENT_TIMESTAMP,
				expired_at      TEXT	DEFAULT NULL)`)
	]);

	await Promise.all([
		db.run(`INSERT INTO chats default values`),
		db.run(`INSERT INTO chats default values`),
		db.run(`INSERT INTO chats default values`),
		db.run(`INSERT INTO chats default values`),

		db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("jameslittle", "$2b$10$poJgedWL57PEMaDHOt/MkuXJmJH4Cw1lfa5MjJitJGcaStEmRqyI2", "James", "Little")`),
		db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("maddie", "$2b$10$poJgedWL57PEMaDHOt/MkuXJmJH4Cw1lfa5MjJitJGcaStEmRqyI2", "Maddie", "Tucker")`),
		db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES ("danny", "$2b$10$poJgedWL57PEMaDHOt/MkuXJmJH4Cw1lfa5MjJitJGcaStEmRqyI2", "Danny", "Little")`),

		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 1)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 1)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 2)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 2)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 3)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 3)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (1, 4)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (2, 4)`),
		db.run(`INSERT INTO user_chat (user_id, chat_id) VALUES (3, 4)`)
	]);

	return res.send(true);
})

/** Run **/
var dbPromise = sqlite.open('./db/main.db', { Promise });
dbPromise.then((dbFromPromise) => {
	db = dbFromPromise;
	server.listen(8080);
	console.log("Server started");
})

io.on('connection', function(socket) {
	socket.on('disconnect', () => {handleDisconnect(socket.id)});
	socket.on('msg', (m) => {handleIncomingMessage(m, socket.id)});
})