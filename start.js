const express = require('express');
const bodyParser = require('body-parser');

const path = require('path');
const morgan = require('morgan');
const rp = require('request-promise');

// Keep all events and merchants summaries
var allEvents = [];
var merchantSummaries = {};
var merchants = ['YcxOCwj0jg', 'iWU4p9dJ9m'];

const app = express();
// console log request data 
app.use(morgan(':date :remote-addr :status :method :response-time ms :url :user-agent'));
// middleware for parsing the body to json
app.use(bodyParser.json());


// Basic routing
//
// Return all events records with product details
app.get('/events', function (req, res) {
    res.json(allEvents);
});

// Return merchant summary 
app.get('/merchantsummary/:id', function (req, res) {
    // Validate merchant id
    if (validateMerchant(req.params.id)) {
        res.json(merchantSummaries[req.params.id]);
    } else {
        errorHandling({message: 'Invalid merchant', status: 404}, res);
    }
});

// Endpoint for adding events
app.post('/addevents', function (req, res) {
    return processEvents(req, res); //.then(res.send(200));
})

// Local server listener
app.listen(3000, () => {
    console.log('started at port 3000');
});




function processEvents(req, res) {
    let eventsQ = Promise.resolve(true);
    let events = req.body;
    let eventsResponses = [];

    if (Object.keys(events).length === 0 && events.constructor === Object) {
        return errorHandling({message: 'No events', status: 400}, res); // bad data response
    }

    events.forEach(event => {
        eventsQ = eventsQ.then(() => {
            return populateProducts(event)
                .then(updateEvents)
                .then(updateMerchantSummary)
                .then((event) => {
                    if (event.type === 'product-view') {
                        eventsResponses.push(event);
                    }
                });
        });
    });
    return eventsQ
        .then((event) => sendResponse(req, res, eventsResponses))
        .catch(err => errorHandling(err, res));
}
    
// Currently only sending status and logs the error    
function errorHandling(err, res) {
    console.log(err);
    res.sendStatus(err.status || 500);
}


function updateEvents(event) {
    allEvents.push(event);
    return event;
}

function updateMerchantSummary(event) {
    let merchantEvents, merchantSummary;

    // Set a new record if the event is for a new merchant
    if (!merchantSummaries[event.merchant]) {
        merchantSummaries[event.merchant] = JSON.parse(merchantSummaryTemplate);
    }
    merchantSummary = merchantSummaries[event.merchant];
    
    merchantSummary.total_events++;
    merchantSummary.number_of_customers++;

    merchantEventsSummary = merchantSummary.events_summary.find(eventType => {
        return eventType.type === event.type;
    });

    merchantEventsSummary.total_events++;
    // Number of customers has to be discussed 
    // whether a set of the customers should be kept in order to prevent duplications
    merchantEventsSummary.number_of_customers++;
    if (event.type === 'transaction') { // hard coded feature for the event type
        merchantEventsSummary.total_value += event.data.transaction.total;
    }
    
    return event;
}

// Sending back response for all "product-view" events in the same request
function sendResponse(req, res, eventsResponses) {
    if (eventsResponses.length > 0) {
        res.json(eventsResponses);
    }
}

// Handling the data population for different types of event
function populateProducts(event) {
    switch (event.type) {
        case 'product-view':
            return populateProductsForView(event);
            break;
        case 'transaction':
            return populateProductsForTransaction(event);
            break;
        default:
            console.log('ERR: Unhandled event');
            return Promise.reject({message: 'ERR: Unhandled event', status: 400});
    };
}

function populateProductsForView(event) {
    return getProductDetails(event.merchant, event.data.product.sku_code).then((product) => {
        event.data.product = product;
        return event;
    });
}

function populateProductsForTransaction(event) {
    let productLineQ = Promise.resolve(true);
    event.data.transaction.line_items.forEach(lineItem => {
        productLineQ = productLineQ.then(() => getProductDetails(event.merchant, lineItem.product.sku_code))
            .then((product) => {
                lineItem.product = Object.assign(lineItem.product, product);
            });
    });
    return productLineQ.then(() => event);
}

// Product details request 
function getProductDetails(merchant, sku_code) {
    let options = {
        uri: 'https://dev.backend.usehero.com/products/' + sku_code,
        headers: {
            "x-hero-merchant-id": merchant
        },
        json: true
    };
    return rp(options);
}


function validateMerchant(merchantId) {
    return (merchants.indexOf(merchantId) > -1);
}

const merchantSummaryTemplate = JSON.stringify({
    "total_events": 0,
    "number_of_customers": 0,
    "events_summary": [{
        "type": "product-view",
        "total_events": 0,
        "number_of_customers": 0
    }, {
        "type": "transaction",
        "total_events": 0,
        "number_of_customers": 0,
        "total_value": 0
    }]
});
