'use strict';

var CopyUtils = require('../utils/CopyUtils'),
    path = require('path'),
    fs = require('fs'),
    _ = require('lodash'),
    nodeunit = require('nodeunit'),
    TestStatus = require('../lib/TestStatus'),
    log4js = require('log4js');
var logger = log4js.getLogger('mutation-testing-nodeunit');

exports.init = function(grunt, opts) {
    if(opts.testFramework !== 'nodeunit') {
        return;
    }

    var testFiles = opts.specs;
    if(testFiles.length === 0) {
        logger.warn('No test files configured; opts.specs is empty');
    }

    opts.before = function(doneBefore) {
        if(opts.mutateProductionCode) {
            doneBefore();
        } else {
            // Find which files are used in the unit test such that they can be copied
            CopyUtils.copyToTemp(opts.code.concat(opts.specs), 'mutation-testing').done(function(tempDirPath) {
                logger.trace('Copied %j to %s', opts.code.concat(opts.specs), tempDirPath);
                // logger.trace('Copied production code to tmp');

                // Set the basePath relative to the temp dir
                opts.basePath = path.join(tempDirPath, opts.basePath);

                testFiles = _.map(testFiles, function(file) {
                    return path.join(tempDirPath, file);
                });

                // Set the paths to the files to be mutated relative to the temp dir
                opts.mutate = _.map(opts.mutate, function(file) {
                    return path.join(tempDirPath, file);
                });

                fs.symlinkSync('/home/skoblins/workspace/nodeoam/node_modules', path.join(tempDirPath, 'node_modules'));
                // fs.symlinkSync('/home/skoblins/workspace/nodeoam/src/pki', path.join(tempDirPath, 'src/pki'));

                doneBefore();
            });
        }
    };

    opts.test = function(done) {
        nodeunit.on('complete', function(name, assertions){
            if (assertions.failures() === 0) {
                done(TestStatus.SURVIVED);
            } else {
                done(TestStatus.KILLED);
            };
        });

        try{
            nodeunit.runFiles(testFiles, {});
        } catch (error){
            done(TestStatus.KILLED);
        }
    }
}
