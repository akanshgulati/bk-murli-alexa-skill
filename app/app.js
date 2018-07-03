'use strict';

// =================================================================================
// App Configuration
// =================================================================================

const {App} = require('jovo-framework');
const moment = require('moment');
const axios = require('axios');
const Languages = require('./language.json');

const config = {
    logging: true,
    intentMap: {
        'AMAZON.PauseIntent': 'PauseIntent',
        'AMAZON.ResumeIntent': 'ResumeIntent',
        'AMAZON.StopIntent': 'StopIntent'
    },
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
function getCalendarDate(date, timezone){
    if(!date){
        return;
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
    let city = '';
    let state = '';
    let timeZoneId = '';
    const MAPS_KEY = 'asdasd';

    return axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${countryCode},${zipcode}`)
    .then((response) => {
        city = response.data.results[0].address_components[1].short_name;
        state = response.data.results[0].address_components[3].short_name;
        lat = response.data.results[0].geometry.location.lat;
        lng = response.data.results[0].geometry.location.lng;
        return axios.get(`https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${moment().unix()}`)
    })
    .then((response) => {
        return timeZoneId = response.data.timeZoneId;
    })
}

function getLanguageLocale(language) {
    return Languages[language];
}

app.setHandler({
    'LAUNCH': function() {
        this.toIntent('PlayIntent');
    },
    'PlayIntent': function(date, language, seconds) {
       // console.log("Date", date, "language", language, "seconds", seconds);
        let self = this;
        const languageLocale = language && getLanguageLocale(language.value);
        this.user().getCountryAndPostalCode().then((data) => {
            getTimeZoneId(data.countryCode, data.postalCode).then(timezone => {
                let params;
                const _date = date && date.value || moment().utcOffset(timezone).format('YYYY-MM-DD');

                params = {
                    date: _date,
                    language: languageLocale || 'en',
                };

                self.user().data.songToPlay = interpolate(song, params);
                const calendarDate = getCalendarDate(_date, timezone);
                const offsetSeconds = seconds && seconds.value ? seconds.value * 1000 : 0;

                let speech = '';
                speech += offsetSeconds ? `from ${offsetSeconds} seconds ` : '';
                speech += languageLocale ? `in ${language.value} language.` : '';

                self.alexaSkill().audioPlayer().setOffsetInMilliseconds(offsetSeconds)
                .play(self.user().data.songToPlay, 'token')
                .tell(`Playing murli for ${calendarDate} ` + speech);
            });
        }).catch((error) => {
            console.log(error);
            if (error.code === 'NO_USER_PERMISSION') {
                this.alexaSkill()
                .showAskForCountryAndPostalCodeCard()
                .tell('Please grant access to your address from App');
            }
        });
    },

    'PauseIntent': function() {
        this.alexaSkill().audioPlayer().stop();

        // Save offset to database
        this.user().data.offset = this.alexaSkill().audioPlayer().getOffsetInMilliseconds();

        this.tell('Paused!');
    },

    'ResumeIntent': function() {
        this.alexaSkill().audioPlayer().setOffsetInMilliseconds(this.user().data.offset)
            .play(this.user().data.songToPlay, 'token')
            .tell('Resuming the murli!');
    },

    'StopIntent': function() {
        this.alexaSkill().audioPlayer().stop();
        this.user().data.offset = 0;
        this.tell('Stopped!');
        this.endSession();
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
        },
    },
});

module.exports.app = app;