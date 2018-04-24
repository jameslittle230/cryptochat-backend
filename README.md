# CryptoChat: Backend

*See it live at <http://penguinegg.com>*

***

CryptoChat is a final project for AIT-Budapest's Cryptography course. 
The goal is to make an end-to-end encrypted chat service with a well-defined attacker model that uses a thoroughly-designed secure channel and message protocol that uses well-known encryption primitives.

## Development

To develop this, you'll need a computer with NodeJS, NPM, and some sort of web server installed.

Make sure to clone both this and the backend repository onto your hard drive somewhere. 
You'll need a web server serving the frontend content through HTTP and a NodeJS server as the HTTP endpoint, the socket connection, and the database interface.
Furthermore, you'll need a browserify (and watchify) instance to package all the frontend Javascript libraries into `build.js`.

### Setup:

Independently of downloading this repo:

~~~
$ sudo apt-get install nodejs
~~~

In this repo's directory:

~~~
$ npm install
~~~

To run the server:

~~~
$ nodejs index.js
~~~

## Deployment

On your deployment server, you'll want something to turn the NodeJS process into a daemon so the process doesn't stop forever if it encounters an error.
I use `forever`, which you can install by running

~~~
$ npm install -g forever
~~~

Then, you can start the server by running

~~~
$ forever nodejs index.js
~~~

Whenever you pull new changes, you can run

~~~
$ forever restartall
~~~

to start serving new changes.

## Contribution

I mean, you can, if you want.
The assignment isn't final until the end of May, so I won't really look at anything until then.
