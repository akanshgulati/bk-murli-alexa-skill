'use strict';

// =================================================================================
// App Configuration
// =================================================================================

const {App} = require('jovo-framework');
const moment = require('moment');
const axios = require('axios');
const Promise = require('bluebird');
const Languages = require('./language.json');
const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const config = {
    logging: true,
    intentMap: {
        'AMAZON.StopIntent': 'StopIntent',
        'AMAZON.PauseIntent': 'PauseIntent',
        'AMAZON.ResumeIntent': 'ResumeIntent'
    }
};

const app = new App(config);

const song = 'https://madhubanmurli.org/murlis/{language}/mp3/murli-{date}.mp3';

// =================================================================================
// App Logic
// =================================================================================
function interpolate(string, obj) {
    Object.keys(obj).forEach(key => {
        const regex = new RegExp('{' + key + '}');
        string = string.replace(regex, obj[key]);
    });
    return string;
}

function getCalendarDate(date, timezone) {
    if (!date) {
        return;
    }
    if (!timezone && date) {
        return moment(date).format('Do MMM');
    }
    return moment(date).utcOffset(timezone).calendar(null, {
        sameDay: '[today]',
        nextDay: '[tomorrow]',
        nextWeek: 'dddd',
        lastDay: '[yesterday]',
        lastWeek: '[last] dddd',
        sameElse: 'dddd, YYYY-MM-DD'
    });
}

function getTimeZoneId(countryCode, zipcode) {
    let lat = 0;
    let lng = 0;

    return axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${countryCode},${zipcode}`).
        then((response) => {
            /*city = response.data.results[0].address_components[1].short_name;
            state = response.data.results[0].address_components[3].short_name;*/
            lat = response.data.results[0].geometry.location.lat;
            lng = response.data.results[0].geometry.location.lng;
            return axios.get(
                `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${moment().
                    unix()}`)
        }).
        then((response) => {
            const timezone =  response && response.data && response.data.timeZoneId;
            return {timezone};
        }).catch(error => {
            throw error;
        })
}

function getLanguageLocale(language) {
    return Languages[language];
}

function getUserTimeZoneDetails(user) {
    if (!user) {
        return;
    }
    return user.getCountryAndPostalCode().then((data) => {
        const response = {
            timezone: DEFAULT_TIMEZONE,
            isDefault: true
        };
        // if user timezone value is not found
        if (!data || !data.countryCode) {
            return Promise.resolve(response);
        }
        return getTimeZoneId(data.countryCode, data.postalCode);
    }).catch((error) => {
        return Promise.reject(error);
    });
}

function getDate(date, user) {
    return new Promise((resolve, reject) => {
        return getUserTimeZoneDetails(user).then(({timezone, isDefault}) => {

            if (date && date.value && !isDefault) {
                resolve(moment(date.value).utcOffset(timezone).format('YYYY-MM-DD'), timezone);
            } else if (date && date.value && isDefault) {
                resolve(moment(date.value).utcOffset(timezone).format('YYYY-MM-DD'));
            } else {
                resolve(moment().utcOffset(timezone).format('YYYY-MM-DD'));
            }
        }, reject);
        //resolve(date && date.value);
    });
}

app.setHandler({
    'LAUNCH': function() {
        console.log('ENTERED HERE');
        this.toIntent('PlayIntent');
    },
    'PlayIntent': function(date, language, seconds) {
        let self = this;
        console.log("Date: ", date);
        console.log("Language", language);
        console.log("Seconds", seconds);

        const languageLocale = language && getLanguageLocale(language.value);
        console.log('Selected language, ', languageLocale);
        // date will always be returned
        return getDate(date, this.user()).then((_date, _timezone) => {
            const params = {
                date: _date,
                language: languageLocale || 'en'
            };
            console.log('Params', params);

            self.user().data.songToPlay = interpolate(song, params);
            const calendarDate = getCalendarDate(_date, _timezone);
            const offsetSeconds = seconds && seconds.value ? seconds.value * 1000 : 0;

            let speech = '';
            console.log("lan", language);
            // if specified language by user is not available
            if (language && language.value && !languageLocale) {
                speech += 'Sorry, We currently don\'t support ${language.value} language <break time="0.5s"/>'
            }
            speech += `Playing murli for ${calendarDate} `;
            speech += offsetSeconds ? `from ${offsetSeconds} seconds ` : '';
            speech += languageLocale ? `in ${language.value} language.` : '';

            self.alexaSkill().
                audioPlayer().
                setOffsetInMilliseconds(offsetSeconds).
                play(self.user().data.songToPlay, 'token').
                tell(speech);
        }, (error) => {
            console.log('Error in getting country and address', error);
            if (error.code === 'NO_USER_PERMISSION') {
                this.alexaSkill.showAskForCountryAndPostalCodeCard().
                    tell('Please grant access to your address from App');
            }
        });
    },
    'StopIntent': function() {
        this.alexaSkill().audioPlayer().stop();
        this.user().data.offset = 0;
        this.tell('Stopped!');
    },
    'PauseIntent': function() {
        this.alexaSkill().audioPlayer().stop();
        // Save offset to database
        this.user().data.offset = this.alexaSkill().audioPlayer().getOffsetInMilliseconds();

        this.tell('Murli is paused, you can resume it!');
    },

    'ResumeIntent': function() {
        this.alexaSkill().
            audioPlayer().
            setOffsetInMilliseconds(this.user().data.offset).
            play(this.user().data.songToPlay, 'token').
            tell('Resuming the murli!');
    },
    Unhandled() {
        const currentPlayBackOffsetTime = this.alexaSkill().audioPlayer().getOffsetInMilliseconds();
        if (!currentPlayBackOffsetTime) {
            this.tell('Something went wrong, please try again');
        } else {
            this.tell('Something went wrong, stopping murli, please try again');
            this.toIntent('StopIntent');
        }
    },

    'AUDIOPLAYER': {
        'AudioPlayer.PlaybackStarted': function() {
            console.log('AudioPlayer.PlaybackStarted');
            this.endSession();
        },

        'AudioPlayer.PlaybackNearlyFinished': function() {
            console.log('AudioPlayer.PlaybackNearlyFinished');
            this.endSession();
        },

        'AudioPlayer.PlaybackFinished': function() {
            console.log('AudioPlayer.PlaybackFinished');
            this.alexaSkill().audioPlayer().stop();
            this.endSession();
        },

        'AudioPlayer.PlaybackStopped': function() {
            console.log('AudioPlayer.PlaybackStopped');
            this.endSession();
        }
    }
});

module.exports.app = app;
