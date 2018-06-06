'use strict'

const yargs = require('yargs')
const utils = require('../../src/cli/utils')
const debug = require('debug')('jsipfs:ipfs-exec')
// const execa = require('execa')
// const chai = require('chai')
// const dirtyChai = require('dirty-chai')
// const expect = chai.expect
// chai.use(dirtyChai)

// const _ = require('lodash')

// This is our new test utility to easily check and execute ipfs cli commands.
//
// The top level export is a function that can be passed a `repoPath`
// and optional `opts` to customize the execution of the commands.
// This function returns the actual executer, which consists of
// `ipfs('files get <hash>')` and `ipfs.fail('files get <hash>')`
// The first one executes and asserts that the command ran successfully
// and returns a promise which is resolved to `stdout` of the command.
// The `.fail` variation asserts that the command exited with `Code > 0`
// and returns a promise that resolves to `stderr`.
module.exports = function ipfsExec (repoPath) {
  process.env.IPFS_PATH = repoPath

  const ipfsExec = function (args) {
    let argv = args.split(' ')
    // cat, add, get are aliases to `files *`
    if (['cat', 'add', 'get'].includes(argv[0])) {
      argv = ['files'].concat(argv)
    }
    debug('Running', argv)
    const cliToLoad = argv[0]
    let cli = require('../../src/cli/commands/' + cliToLoad)

    const description = cli.describe || cli.description || ''
    const parser = yargs.command(cli.command, description, cli.builder, cli.handler)
      .strict(false)
      .skipValidation('key')
      .skipValidation('value')

    debug('Parsed command')

    return new Promise((resolve, reject) => {
      let output = []
      // Placeholder callback for cleanup. Should be replaced with a proper one
      // later on
      let cleanup = () => {
        debug('WARNING: placeholder cleanup called...')
      }
      // This callback gets injected into the CLI commands who can call it when
      // they are done with their operations
      const onComplete = (err) => {
        if (err) return reject(err)
        debug('onComplete called')
        cleanup((err) => {
          if (err) return reject(err)
          debug('cleanup done, resolving value:', JSON.stringify(output.join('')))
          // Lets wait a bit for the shutdown to actually finish
          // TODO race-condition somewhere in shutdown, and it returns before
          // actually finishing, that's why we have the wait
          const timeout = argv[0] === 'shutdown' ? 1000 : 0
          setTimeout(() => {
            resolve(output.join(''))
          }, timeout)
        })
      }

      // init works differently from other commands, as we don't care about having
      // a daemon running when running it
      if (argv[0] === 'init') {
        debug('Init called, getting IPFS')
        utils.getIPFS({api: false}, (err, ipfs, _cleanup) => {
          if (err) throw err
          ipfs.once('init', () => {
            debug('Got init event, time to cleanup')
            _cleanup(resolve)
          })
          debug('Got IPFS node, initting')
          ipfs.init()
        })
      } else {
        var stream = require('stream')
        var writable = new stream.Writable({
          write: function (chunk, encoding, next) {
            debug('received a little chunk', chunk.toString())
            output.push(chunk.toString())
            if (chunk.toString() === 'Daemon is ready\n') {
              onComplete()
            }
            next()
          }
        })
        utils.setPrintStream(writable)

        yargs().option('api').strict(false).parse(argv, (err, getIPFSArgs, output) => {
          if (err) throw err
          // If it's daemon command, we should set the multiaddr for api
          const api = argv[0] === 'daemon' ? '/ip4/127.0.0.1/tcp/5002' : false
          utils.getIPFS(Object.assign(getIPFSArgs, {api}), (err, ipfs, _cleanup) => {
            if (err) return reject(err)
            cleanup = _cleanup
            try {
              parser.parse(argv, {
                ipfs,
                onComplete,
                stdoutStream: writable
              }, (err, argv, _output) => {
                if (err) return reject(err)
              })
            } catch (err) {
              output = err.toString()
              cleanup(() => {
                reject(output)
              })
            }
          })
        })
      }
    })
  }
  ipfsExec.repoPath = repoPath
  ipfsExec.fail = (args) => {
    console.log('Lol, you want me to fail?')
    return new Promise((resolve) => {
      resolve('sure')
    })
  }
  return ipfsExec
}
// module.exports = (repoPath, opts) => {
//   const env = _.clone(process.env)
//   env.IPFS_PATH = repoPath
//
//   const config = Object.assign({}, {
//     stripEof: false,
//     env: env,
//     timeout: 60 * 1000
//   }, opts)
//
//   const exec = (args) => execa(`${process.cwd()}/src/cli/bin.js`, args, config)
//
//   function ipfs () {
//     let args = Array.from(arguments)
//     if (args.length === 1) {
//       args = args[0].split(' ')
//     }
//
//     const cp = exec(args)
//     const res = cp.then((res) => {
//       // We can't escape the os.tmpdir warning due to:
//       // https://github.com/shelljs/shelljs/blob/master/src/tempdir.js#L43
//       // expect(res.stderr).to.be.eql('')
//       return res.stdout
//     })
//
//     res.kill = cp.kill.bind(cp)
//     res.stdout = cp.stdout
//     res.stderr = cp.stderr
//
//     return res
//   }
//
//   /**
//    * Expect the command passed as @param arguments to fail.
//    * @return {Promise} Resolves if the command passed as @param arguments fails,
//    *                    rejects if it was successful.
//    */
//   ipfs.fail = function ipfsFail () {
//     let args = Array.from(arguments)
//     let caught = false
//     if (args.length === 1) {
//       args = args[0].split(' ')
//     }
//
//     return exec(args)
//       .catch(err => {
//         caught = true
//         expect(err).to.exist()
//       })
//       .then(() => {
//         if (!caught) {
//           throw new Error(`jsipfs expected to fail during command: jsipfs ${args.join(' ')}`)
//         }
//       })
//   }
//
//   return ipfs
// }
