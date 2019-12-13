'use strict';

const http = require('http');
const qs = require('querystring');
const request = require('request');
const rp = require('request-promise');

const slackFieldNameJoinDate = 'Xf59UWGT47';
const slackFieldNameOfficeLocation = 'Xf58HHDEJV';
const slackFieldNameOfficeFloor = 'XfRNDPVBT2';
const slackFieldNameOrganisation = 'XfRAV9GY91';

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

function sendSlackPostMessage(slackChannel, slackMessageContent) {
    const slackMessage = {
        channel: slackChannel,
        username: 'BirdFinder Bot',
        icon_emoji: ':bird:',
        text: slackMessageContent
    };

    request.post({
            url: 'https://slack.com/api/chat.postMessage',
            auth: {
                'bearer': process.env.SLACK_API_TOKEN
            },
            json: slackMessage
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

function buildReplyMessage(userData, userCustomFields) {
    let message = "Hi! I asked a bit around about " + userData.real_name +
        " and found out that " + (userData.profile.first_name ? userData.profile.first_name : userData.real_name) + " ";

    let fieldItems = []

    if (userCustomFields.joinDate !== '') {
        fieldItems.push("is at MessageBird since " + userCustomFields.joinDate);
    }

    if (userCustomFields.title !== '') {
        fieldItems.push("has the role as " + userCustomFields.title);
    }

    if (userCustomFields.orgName !== '') {
        fieldItems.push("is part of the " + userCustomFields.orgName + " organisation");
    }

    if (userCustomFields.officeLocation !== '') {
        fieldItems.push("is located in " + userCustomFields.officeLocation);
    }

    if (userCustomFields.officeFloor !== '') {
        let officeFloor = userCustomFields.officeFloor;
        if (!isNaN(officeFloor)) {
            officeFloor = addOrdinalSuffix(officeFloor);
        }

        fieldItems.push("has a desk at the " + officeFloor + " floor");
    }

    return message + formatArrayWithCommasAndAnd(fieldItems);
}

function addOrdinalSuffix(i) {
    var j = i % 10,
        k = i % 100;
    if (j == 1 && k != 11) {
        return i + "st";
    }
    if (j == 2 && k != 12) {
        return i + "nd";
    }
    if (j == 3 && k != 13) {
        return i + "rd";
    }
    return i + "th";
}

function respondWithMessage(res, messageObject) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify(messageObject));
    res.end();
}

function getUserCustomFields(slackUserData) {
    let userCustomFields = {
        title: '',
        joinDate: '',
        orgName:'',
        officeLocation: '',
        officeFloor: ''
    };

    if (slackUserData.profile.title !== undefined) {
        userCustomFields.title = slackUserData.profile.title;
    }

    try {
        if (slackUserData.profile.fields[slackFieldNameJoinDate].value !== undefined) {
            userCustomFields.joinDate = slackUserData.profile.fields[slackFieldNameJoinDate].value;
        }
    } catch (e) {
        // ignore
    }

    try {
        if (slackUserData.profile.fields[slackFieldNameOrganisation].value !== undefined) {
            userCustomFields.orgName = slackUserData.profile.fields[slackFieldNameOrganisation].value;
        }
    } catch (e) {
        // ignore
    }

    try {
        if (slackUserData.profile.fields[slackFieldNameOfficeLocation].value !== undefined) {
            userCustomFields.officeLocation = slackUserData.profile.fields[slackFieldNameOfficeLocation].value;
        }
    } catch (e) {
        // ignore
    }
    try {
        if (slackUserData.profile.fields[slackFieldNameOfficeFloor].value !== undefined) {
            userCustomFields.officeFloor = slackUserData.profile.fields[slackFieldNameOfficeFloor].value;
        }
    } catch (e) {
        // ignore
    }

    return userCustomFields;
}

function formatArrayWithCommasAndAnd(items) {
    return [items.slice(0, -1).join(', '), items.slice(-1)[0]].join(items.length < 2 ? '' : ' and ');
}

function getMissingFields(userCustomFields) {
    let missingFields = [];

    if (userCustomFields.title === '') {
        missingFields.push('title');
    }
    if (userCustomFields.joinDate === '') {
        missingFields.push('join date');
    }
    if (userCustomFields.orgName === '') {
        missingFields.push("organisation name");
    }
    if (userCustomFields.officeLocation === '') {
        missingFields.push("office location");
    }
    if (userCustomFields.officeFloor === '') {
        missingFields.push("floor");
    }

    if (missingFields.length === 0) {
        return '';
    }

    return formatArrayWithCommasAndAnd(missingFields);
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

            let requesteeMissingFields = getMissingFields(requesteeCustomFields);
            if (requesteeMissingFields && requesteeData.id !== post.user_id) {
                sendSlackPostMessage(
                    requesteeData.id,
                    "Hi, Someone requested some location data about you (via `/find @" + requesteeData.profile.display_name + "`), " +
                    "and it looks like you haven't filled in " + requesteeMissingFields + " in your Slack profile.\n " +
                    "It's easy, just click on https://messagebird.slack.com/account/profile"
                );
            }

            let requestorData = await findSlackUserData(post.user_id);
            let requestorCustomFields = getUserCustomFields(requestorData);
            let requestorMissingFields = getMissingFields(requestorCustomFields);

            let replyObject = {
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": buildReplyMessage(requesteeData, requesteeCustomFields)
                        },
                    }
                ]
            };

            if (requesteeData.profile.image_192 !== undefined) {
                replyObject.blocks[0].accessory = {
                    "type": "image",
                    "image_url": requesteeData.profile.image_192,
                    "alt_text": requesteeData.profile.real_name + " photo"
                };
            }

            if (requestorMissingFields) {
                replyObject.blocks.push({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "By the way, I see that you are missing " + requestorMissingFields + ' ' +
                            'information from your profile. How about filling it now? It\'s easy, just click on ' +
                            'https://messagebird.slack.com/account/profile'
                    }
                });
            }

            respondWithMessage(res, replyObject);
        });
    } catch (error) {
        console.log(error);

        res.writeHead((error.code ? error.code : 500), {'Content-Type': 'application/json'});
        res.write(JSON.stringify({response_type: "in_channel", text: error.message}));
        res.end();
    }
}).listen(process.env.PORT ? process.env.PORT : 8080);
console.log('Server listening on port ' + (process.env.PORT ? process.env.PORT : 8080));