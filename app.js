"use strict";

// Check if on AWS
var AWS;
try {
	AWS = require('aws-sdk');
} catch (e) {
	if (e.code === 'MODULE_NOT_FOUND') {
		AWS = null;
	}
}

// Load arguments
var port = process.env.PORT || 3000;
if (AWS !== null) {
	AWS.config.region = process.env.REGION
	var client_id = process.env.client_id;
	var client_secret = process.env.client_secret;
	var redirect_uri = process.env.redirect_uri;
}
else {
	// If not running on AWS variables should be entered as commandline arguments
	var args = process.argv;
	if (!(args.length == 4 || args.length == 5)) {
		console.log('Must enter 2 or 3 commandline arguments')
		console.log('node.exe app.js <client_id> <client_secret> [<redirect_uri>]')
		console.log('Exiting')
		console.log('\n')
		process.exit(-1)
	}
	var client_id = args[2];
	var client_secret = args[3];
	var redirect_uri = args[4] || 'http://localhost:' + port.toString() + '/callback';
}

// Include the cluster module
var cluster = require('cluster');

// Code to run if we're in the master process
if (cluster.isMaster) {

	// Count the machine's CPUs
	var cpuCount = require('os').cpus().length;

	// Create a worker for each CPU
	for (var i = 0; i < cpuCount;i += 1) {
		cluster.fork();
	}

	// Listen for terminating workers
	cluster.on('exit', function (worker) {
		// Replace the terminated workers
		console.log('Worker ' + worker.id + ' died :(');
		cluster.fork();
	});

// Code to run if we're in a worker process
} else {
	var express = require('express');
	var request = require('request');
	var querystring = require('querystring');
	var cookieParser = require('cookie-parser');

	var app = express();

	var generateRandomString = function(length) {
		var text = '';
		var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

		for (var i = 0; i < length; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	};

	function logLogin(access_token, refresh_token) {
		console.log('User logging in...');
		console.log(new Date(Date.now()).toLocaleString());
		var options = {
			url: 'https://api.spotify.com/v1/me',
			headers: { 'Authorization': 'Bearer ' + access_token },
			json: true
		};
		request.get(options, function(error, response, body) {
			console.log('\tName: ', body.display_name);
			console.log('\tEmail: ', body.email);
			console.log('\tCountry: ', body.country);
			console.log('\trefresh_token', refresh_token);
		});
	}
	
	app.use(express.static(__dirname + '/public'));
	app.use(cookieParser());

	var stateKey = 'spotify_auth_state';
	app.get('/login', function(req, res) {
		var state = generateRandomString(16);
		res.cookie(stateKey, state);

		// your application requests authorization
		var scope = 'user-read-private user-read-email user-top-read';
		res.redirect('https://accounts.spotify.com/authorize?' +
			querystring.stringify({
				response_type: 'code',
				client_id: client_id,
				scope: scope,
				redirect_uri: redirect_uri,
				state: state
			}));
	});

	app.get('/callback', function(req, res) {

		// your application requests refresh and access tokens
		// after checking the state parameter

		var code = req.query.code || null;
		var state = req.query.state || null;
		var storedState = req.cookies ? req.cookies[stateKey] : null;

		if (state === null || state !== storedState) {
			res.redirect('/?error=state_mismatch');
		} else {
			res.clearCookie(stateKey);

			var authOptions = {
				url: 'https://accounts.spotify.com/api/token',
				form: {
					code: code,
					redirect_uri: redirect_uri,
					grant_type: 'authorization_code'
				},
				headers: {
					'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
				},
				json: true
			};

			request.post(authOptions, function(error, response, body) {
				if (!error && response.statusCode === 200) {
					logLogin(body.access_token, body.refresh_token);
					res.cookie('access_token', body.access_token, { expires: new Date(Date.now() + body.expires_in * 1000) });
					res.cookie('refresh_token', body.refresh_token);
					res.redirect('/');
				} else {
					res.redirect('/?error=token_invalid');
				}
			});
		}
	});

	app.get('/refresh_token', function(req, res) {

		// requesting access token from refresh token
		var cookies = req.cookies;
		var refresh_token = cookies['refresh_token'];
		if (!refresh_token) res.cookie('refresh_token', refresh_token, { expires: new Date(Date.now()) });

		var authOptions = {
			url: 'https://accounts.spotify.com/api/token',
			headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
			form: {
				grant_type: 'refresh_token',
				refresh_token: refresh_token
			},
			json: true
		};
		console.log("Refreshing token...");
		request.post(authOptions, function(error, response, body) {
			if (!error && response.statusCode === 200) {
				logLogin(body.access_token, refresh_token);
				res.cookie('access_token', body.access_token, { expires: new Date(Date.now() + body.expires_in * 1000)});
				res.redirect('/');
			} else {
				if (error) Console.log('Error in /refresh_token: ', error);
				console.log('Status Code in /refresh_token:', response && response.statusCode);
			}
		});
	});


	var server = app.listen(port, function () {
		console.log('Server running at ' + redirect_uri);
	});
}
