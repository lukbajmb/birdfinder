'use strict';

const http = require('http');
const qs = require('querystring');
const request = require('request');
const moment = require('moment');
var rp = require('request-promise');

const JoinDateFieldName = 'Xf59UWGT47';
const OfficeLocationFieldName = 'Xf58HHDEJV';
const OfficeFloorFieldName = 'XfRNDPVBT2';
const OrganisationFieldName = 'XfRAV9GY91';

function createInitialMessage(incidentName, slackUserName, incidentSlackChannel, incidentSlackChannelId) {
    // Prepare a rich Slack message
    // See https://api.slack.com/docs/message-formatting
    var slackMessage = {
        username: 'Incident Management',
        icon_emoji: ':warning:',
        attachments: [],
        link_names: true,
        parse: 'full',
    };

    slackMessage.attachments.push({
        color: '#8f0000',
        title: incidentName,
        text: "Incident Channel: #" + incidentSlackChannel,
        "fallback": "Join Incident Channel #" + incidentSlackChannel,
        "actions": [
            {
                "type": "button",
                "text": "Join Incident Channel",
                "url": "slack://channel?team=" + process.env.SLACK_TEAM_ID + "&id=" + incidentSlackChannelId,
                "style": "danger"
            }
        ],
        footer: `reported by @${slackUserName}`
    });
    return slackMessage;
}

function verifyPostRequest(method) {
    if (method !== 'POST') {
        const error = new Error('Only POST requests are accepted');
        error.code = 405;
        throw error;
    }
}

function verifySlackWebhook(body) {
    if (!body || body.token !== process.env.SLACK_COMMAND_TOKEN) {
        const error = new Error('Invalid credentials');
        error.code = 401;
        throw error;
    }
}

async function findSlackUserData(userId) {
    // let userId = "U04FNFFDT";

    let userData = await requestSlackUserData(userId);
    if (userData != false) {
        // console.log(userData);

        return userData;
    } else {
        console.log('User for UserId %s not found', userId);
    }
}

async function requestSlackUserData(userId) {
    return rp({
        url: 'https://slack.com/api/users.info',
        qs: {
            'user': userId,
            'token': process.env.SLACK_API_TOKEN
        },
        method: 'GET',
        json: true
    }).then(function (res) {
        return res.user;
    })
    .catch(function (err) {
        console.log(err);

        return false;
    });
}

function sendSlackMessageToChannel(slackChannel, slackMessage, pin_message) {
    if (process.env.DRY_RUN) {
        console.log("Sending message below to channel " + slackChannel);
        console.log(slackMessage);
        return;
    }
    const newMessage = {
        ...slackMessage,
        channel: slackChannel
    };

    request.post({
            url: 'https://slack.com/api/chat.postMessage',
            auth: {
                'bearer': process.env.SLACK_API_TOKEN
            },
            json: newMessage
        },
        function (error, response, body) {
            if (error) {
                console.error('Sending message to Slack channel failed:', error);
                throw new Error('Sending message to Slack channel failed');
            }
            if (pin_message) {
                var ts = body['ts'];
                var channel = body['channel'];
                request.post({
                        url: 'https://slack.com/api/pins.add',
                        auth: {
                            'bearer': process.env.SLACK_API_TOKEN
                        },
                        json: {
                            'channel': channel,
                            'timestamp': ts
                        }
                    }, (error, response) => {
                        if (error) {
                            console.log('Error pinning message to channel: ' + error);
                        }
                    }
                );
            }
        });
}

function getRequesteeSlackUserId(text) {
    var requesteeId = '';
    try {
        requesteeId = text
            .split("<@")[1]
            .split("|")[0];
    } catch (e) {
        console.log(text, e);
    }
    return requesteeId;
}

function respondWithMessage(res, message) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify({
        text: message
    }));
    res.end();
}

http.createServer(function (req, res) {
    try {
        verifyPostRequest(req.method);

        var body = '';
        var post = {};
        req.on('data', function (chunk) {
            body += chunk;
        });

        req.on('end', async function () {
            console.log('body: ' + body);
            post = qs.parse(body);

            verifySlackWebhook(post);

            // Which data is available?
            // Parse data and concatenated message back to requester

            // v2: When not all data is available for requestee, ask the requester if requestee should be informed about this
            // v2: Inform requestee to fill in more data

            // v3: Find user data of @requester?
            // v3: Has requester filled in all details?

            // var incidentChannelId = await createIncidentFlow(post);
            var requesteeData = await findSlackUserData(getRequesteeSlackUserId(post.text));
            console.log("requesteeData");
            console.log(requesteeData);
            var requestorData = await findSlackUserData(post.user_id);
            console.log("requestorData");
            console.log(requestorData);

            if (requesteeData === undefined) {
                respondWithMessage(res, "No Slack user found with this username. Try again");
                return;
            }

            res.writeHead(200, {'Content-Type': 'application/json'});
            res.write(JSON.stringify({
                text: "Received your request about finding " + requesteeData.real_name
            }));
            res.end();
        });
    } catch (error) {
        console.log(error);

        res.writeHead((error.code ? error.code : 500), {'Content-Type': 'application/json'});
        res.write(JSON.stringify({response_type: "in_channel", text: error.message}));
        res.end();
    }
}).listen(process.env.PORT ? process.env.PORT : 8080);
console.log('Server listening on port ' + (process.env.PORT ? process.env.PORT : 8080));
