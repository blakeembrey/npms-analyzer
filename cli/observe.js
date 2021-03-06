'use strict';

const assert = require('assert');
const promiseRetry = require('promise-retry');
const realtime = require('../lib/observers/realtime');
const stale = require('../lib/observers/stale');
const bootstrap = require('./util/bootstrap');
const stats = require('./util/stats');

const log = logger.child({ module: 'cli/observe' });

/**
 * Pushes a package into the queue, retrying several times on error.
 * If all retries are used, there isn't much we can do, therefore the process will gracefully exit.
 *
 * @param {array}  name     The package name
 * @param {number} priority The priority to assign to this package when pushing into the queue
 * @param {Queue}  queue    The analysis queue instance
 *
 * @return {Promise} The promise that fulfills once done
 */
function onPackage(name, priority, queue) {
    return promiseRetry((retry) => {
        return queue.push(name, priority)
        .catch(retry);
    })
    .catch((err) => {
        log.fatal({ err, name }, 'Too many failed attempts while trying to push the package into the queue, exiting..');
        process.exit(1);
    });
}

// ----------------------------------------------------------------------------

module.exports.builder = (yargs) => {
    return yargs
    .strict()
    .usage('Usage: $0 observe [options]\n\n\
Starts the observing process, enqueueing packages that need to be analyzed into the queue.')
    .demand(0, 0)
    .option('default-seq', {
        type: 'number',
        default: 0,
        alias: 'ds',
        describe: 'The default seq to be used on first run',
    })
    .check((argv) => {
        assert(typeof argv.defaultSeq === 'number', 'Invalid argument: --default-seq must be a positive integer');
        return true;
    });
};

module.exports.handler = (argv) => {
    process.title = 'npms-analyzer-observe';
    logger.level = argv.logLevel || 'warn';

    // Bootstrap dependencies on external services
    bootstrap(['couchdbNpm', 'couchdbNpms', 'queue'], { wait: true })
    .spread((npmNano, npmsNano, queue) => {
        // Stats
        stats.process();
        stats.queue(queue);

        // Start observing..
        realtime(npmNano, npmsNano, { defaultSeq: argv.defaultSeq }, (name) => onPackage(name, 1, queue));
        stale(npmsNano, (name) => onPackage(name, 0, queue));
    })
    .done();
};
