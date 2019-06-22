import * as akala from '@akala/core';
import { api } from './api';
import { WorkerRouter } from './router';
import * as jsonrpc from '@akala/json-rpc-ws';
import * as debug from 'debug';
import * as path from 'path';
import { resolve, dirname } from 'path';
import { Request, MasterRegistration, Callback, WorkerInjector, handle } from './worker-meta';
import { metaRouter } from './master-meta'
import { EventEmitter } from 'events'
import { meta } from './api/jsonrpc';

process.on('uncaughtException', function (error)
{
    console.error(process.argv[2]);
    console.error(error);
    process.exit(500);
})
var log = debug('akala:worker:' + process.argv[2]);

var app = new WorkerRouter();

function resolveUrl(namespace: string)
{
    var url = process.argv[3] + '/' + namespace + '/';
    return url;
}

akala.register('$resolveUrl', resolveUrl);

akala.register('$router', app);

var worker: EventEmitter = akala.register('$worker', new EventEmitter());

akala.resolve('$agent.api/manage/' + process.argv[2]).then(function (socket: jsonrpc.Client<jsonrpc.Connection>)
{
    log('worker connected')
    var client = api.jsonrpcws(new akala.DualApi(meta, metaRouter)).createClient(socket, {
        'after-master': () =>
        {
            worker.emit('after-master');
        }, ready: () =>
        {
            worker.emit('ready');
        },
        getContent: handle(app, '/')
    });
    var server = client.$proxy();
    server.register({ path: '/api/' + process.argv[2], remap: '/api' });
    akala.register('$bus', client);

    akala.register('$updateConfig', akala.chain(function (config, key: string)
    {
        var configToSave = {};
        configToSave[key] = config;
        return server.updateConfig(configToSave);
    }, function (keys, config, key: string)
        {
            if (key)
            {
                keys = [].concat(keys);
                keys.push(key);
            }
            return [config, keys.join('.')];
        }));


    akala.register('$config', akala.chain(function (key?: string)
    {
        return server.getConfig({ key: key || null });
    }, function (keys, key)
        {
            if (key)
            {
                keys = [].concat(keys);
                keys.push(key);
            }
            return [keys.join('.')];
        }));

    server.module({ module: process.argv[2] }).then(function (param)
    {
        log('emitted module event')
        var masterCalled = false;
        log(param);
        akala.register('$master', function (from?: string, masterPath?: string, workerPath?: string)
        {
            log(from + ' is not the current module path. Ignoring...');
            return false;
        });
        akala.register('$isModule', () => { return false });

        for (let subworker of param.workers)
        {
            if (!subworker)
                continue;
            log('requiring %s for %s', subworker, process.argv[2]);
            require(subworker);
        }

        // process.chdir(path.join(process.cwd(), 'node_modules', process.argv[2]));
        akala.register('$master', function (from?: string, masterPath?: string, workerPath?: string)
        {
            if (masterCalled)
            {
                console.error('$master was already called');
                return;
            }
            masterCalled = true;
            server.master({ masterPath: masterPath && resolve(dirname(from), masterPath) || null, workerPath: workerPath && resolve(dirname(from), workerPath) || null });
            return masterCalled;
        }, true);

        akala.register('$isModule', (m: string) => { return m == process.argv[2]; }, true);
        log('new cwd: ' + process.cwd());

        if (worker.listenerCount('master') > 0)
        {
            worker.emit('master', function (from?: string, masterPath?: string, workerPath?: string)
            {
                if (masterCalled)
                {
                    console.error('$master was already called');
                    return;
                }
                masterCalled = true;
                server.master({ masterPath: masterPath && resolve(dirname(from), masterPath) || null, workerPath: workerPath && resolve(dirname(from), workerPath) || null });
            });
        }

        require(process.argv[2]);

        if (!masterCalled)
            server.master(null);
    });
});
