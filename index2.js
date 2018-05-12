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
		res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, socket_id");
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
		if (connections[user_id].indexOf(socket.id) != -1) {
			connections[user_id].splice(connections[user_id].indexOf(socket.id), 1);
			if(connections[user_id].length == 0) {
				delete connections[user_id];
				break;
			}
		}
	}
}

/** Get Data **/

async function getAllUsers() {
	const users = await db.all(`SELECT user_id, username, first_name, last_name FROM users`);
	return users;
}

/** Update Keypair **/

async function updateUserKeypair(user_id) {
	var key = new NodeRSA();
	key.generateKeyPair(1024);

	await db.run(`UPDATE keys SET expired_at = datetime('now') WHERE expired_at IS NULL AND user_id = ?`, [user_id]);
	await db.run(`INSERT INTO keys (user_id, public_key, private_key_enc) VALUES (?, ?, ?)`, 
		[user_id, key.exportKey('public'), key.exportKey('private')]);
};

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
	}
	catch(e) {return res.status(400).send(e) }

	var username = req.body.username;
	var plaintextPassword = req.body.password;

	try {
		const data = await db.get(`SELECT * FROM users WHERE username = ? LIMIT 1`, [username]);

		const match = await bcrypt.compare(plaintextPassword, data.password);
		if(!match) throw new loginPasswordMismatchException()

		addToConnections(data.user_id, req.headers.socket_id);

		return res.send({
			success: true,
			user: data
		});

	} catch(error) {
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
	} 
	catch(e) {return res.status(400).send(e) }

	var username = req.body.username;
	var plaintextPassword = req.body.password;
	var first = req.body.first;
	var last = req.body.last;

	try {
		const userSearchData = await db.get(`SELECT password FROM users WHERE username = ? LIMIT 1`, [username]);
		if(userSearchData) throw new registerUserAlreadyExistsException(username);

		const passwordHash = await bcrypt.hash(plaintextPassword, bcryptSaltRounds);

		const newUser = await db.run(`INSERT INTO users (username, password, first_name, last_name) VALUES (?, ?, ?, ?)`, [username, passwordHash, first, last]);
		
		await updateUserKeypair(newUser.lastID);
		
		const singleUserData = await db.get(`SELECT * FROM users WHERE user_id = ? LIMIT 1`, [newUser.lastID]);
		const allUsersData = await getAllUsers();

		io.of('/').emit('users-reload');
		return res.send({
			success: true,
			user: singleUserData
		});
	} catch(error) {
		return res.status(400).send(error);
	}
});


/** Run **/
var dbPromise = sqlite.open('./db/main.db', { Promise });
dbPromise.then((dbFromPromise) => {
	db = dbFromPromise;
	server.listen(8080);
	console.log("Server started");
})

io.on('connection', function(socket) {
	socket.on('disconnect', () => {handleDisconnect(socket.id)});
	socket.on('msg', (m) => {handleIncomingMessage(m)});
})