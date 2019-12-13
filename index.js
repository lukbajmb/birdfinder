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
    if (userData !== undefined) {
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
    }).catch(function (err) {
        console.log(err);
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
        });
}

function getRequesteeSlackUserId(text) {
    try {
        return text
            .split("<@")[1]
            .split("|")[0];
    } catch (e) {
        console.log(text, e);
    }
}

function buildReplyMessage(requesteeData) {
    let message = "Hi! I asked a bit around about " + requesteeData.real_name +
        " and found out that " + requesteeData.real_name + " is ";

    let userCustomFields = getUserCustomFields(requesteeData);

    if (userCustomFields.title !== '') {
        message += "a " + userCustomFields.title + ", ";
    }

    if (userCustomFields.orgname !== '') {
        message += "in " + userCustomFields.orgname + ", ";
    }

    if (userCustomFields.officeLocation !== '') {
        message += "located in " + userCustomFields.officeLocation + ", ";
    }

    if (userCustomFields.floor  !== '') {
        message += "at the " + userCustomFields.floor + " floor";
    }

    message = message.replace(/,\s*$/, "");

    return message;
}

function respondWithMessage(res, messageObject) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify(messageObject));
    res.end();
}

function getUserCustomFields(slackUserData) {
    let userCustomFields = {
        title: '',
        orgname:'',
        officeLocation: '',
        floor: ''};

    if (slackUserData.profile.title !== undefined) {
        userCustomFields.title = slackUserData.profile.title;
    }

    try {
        if (slackUserData.profile.fields[OrganisationFieldName].value !== undefined) {
            userCustomFields.orgname = slackUserData.profile.fields[OrganisationFieldName].value;
        }
    } catch (e) {
        // ignore
    }

    try {
        if (slackUserData.profile.fields[OfficeLocationFieldName].value !== undefined) {
            userCustomFields.officeLocation = slackUserData.profile.fields[OfficeLocationFieldName].value;
        }
    } catch (e) {
        // ignore
    }
    try {
        if (slackUserData.profile.fields[OfficeFloorFieldName].value !== undefined) {
            userCustomFields.floor = slackUserData.profile.fields[OfficeFloorFieldName].value;
        }
    } catch (e) {
        // ignore
    }

    return userCustomFields;
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

            // v2: When not all data is available for requestee, ask the requester if requestee should be informed about this
            // v2: Inform requestee to fill in more data

            // v3: Find user data of @requester?
            // v3: Has requester filled in all details?

            // var incidentChannelId = await createIncidentFlow(post);
            let requesteeUserId = getRequesteeSlackUserId(post.text);
            if (requesteeUserId === undefined) {
                respondWithMessage(res, {
                    text: "You did not send a Slack Display name. The correct format is: `/" + post.command + " @display_name`"
                });
                return;
            }

            let requesteeData = await findSlackUserData(requesteeUserId);
            if (requesteeData === undefined) {
                respondWithMessage(res, {
                    text: "No Slack user found with this username. Try again"
                });
                return;
            }
            let requesteeCustomFields = getUserCustomFields(requesteeData);
            console.log(requesteeCustomFields);


            let requestorData = await findSlackUserData(post.user_id);
            let requestorCustomFields = getUserCustomFields(requestorData);
            console.log(requestorCustomFields);


            respondWithMessage(res, {text: buildReplyMessage(requesteeData)});
        });
    } catch (error) {
        console.log(error);

        res.writeHead((error.code ? error.code : 500), {'Content-Type': 'application/json'});
        res.write(JSON.stringify({response_type: "in_channel", text: error.message}));
        res.end();
    }
}).listen(process.env.PORT ? process.env.PORT : 8080);
console.log('Server listening on port ' + (process.env.PORT ? process.env.PORT : 8080));
