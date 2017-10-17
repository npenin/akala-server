import * as fs from 'fs';
import * as akala from '@akala/core';
import { WorkerRouter } from './router';
import * as jsonrpc from '@akala/json-rpc-ws';
import * as debug from 'debug';
import * as path from 'path';
import { resolve, dirname } from 'path';
import { createClient, Request, MasterRegistration, Callback, WorkerInjector, handle } from './worker-meta';
import { meta, DualMetadata } from './sharedComponent/metadata'
import { Http } from './http';
import { metaRouter } from './master-meta'

process.on('uncaughtException', function (error)
{
    console.error(error);
    process.exit(500);
})
var log = debug('akala:worker:' + process.argv[2]);

//log.enabled = process.argv[2]=='devices';
// if (!debug.enabled('akala:worker:' + process.argv[2]))
//     console.warn(`logging disabled for ${process.argv[2]}`);

var app = new WorkerRouter();

function resolveUrl(namespace: string)
{
    return 'http://localhost:' + process.argv[3] + '/' + namespace + '/';
}

akala.register('$resolveUrl', resolveUrl);

akala.register('$router', app);

akala.register('$io', createClient);

akala.register('$http', new Http());
createClient('api/' + process.argv[2]).then(function (socket: jsonrpc.Client<jsonrpc.Connection>)
{
    log('worker connected')
    akala.register('$bus', socket);

    var client = metaRouter.createClient(socket)({
        getContent: handle(app, '/api'),
    });

    var server = meta.createServerProxy(socket);

    server.module({ module: process.argv[2] }).then(function (param)
    {
        log('emitted module event')
        akala.register('$config', param.config);
        var masterCalled = false;
        log(param);
        akala.register('$master', function (from?: string, masterPath?: string, workerPath?: string)
        {
            log(from + ' is not the current module path. Ignoring...');
            return;
        });
        akala.register('$isModule', false);

        for (var worker of param.workers)
        {
            if (!worker)
                continue;
            log('requiring %s for %s', worker, process.argv[2]);
            require(worker);
        }
        process.chdir(path.join(process.cwd(), 'node_modules', process.argv[2]));
        akala.register('$master', function (from?: string, masterPath?: string, workerPath?: string)
        {
            masterCalled = true;
            server.master({ masterPath: masterPath && resolve(dirname(from), masterPath) || null, workerPath: workerPath && resolve(dirname(from), workerPath) || null });
        }, true);

        akala.register('$isModule', true, true);
        log('new cwd: ' + process.cwd());

        require(process.cwd());

        if (!masterCalled)
            server.master(null);
    });
});
