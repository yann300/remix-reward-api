const express = require('express')
const app = express()
var cors = require('cors')
const multihash = require('multihashes') 
var https = require('https')
var fs = require('fs')
var abi = require('./abi')
var cache = require('./abi')
cache = JSON.parse(cache)

const { ethers } = require('ethers')

const chains = {
    '0x5d470270e889b61c08C51784cDC73442c4554011': 'optimism',
    '0x2bC16Bf30435fd9B3A3E73Eb759176C77c28308D': 'scroll'
}

const providers = {
    '0x5d470270e889b61c08C51784cDC73442c4554011': new ethers.providers.StaticJsonRpcProvider('https://opt-mainnet.g.alchemy.com/v2/cdGnPX6sQLXv-YWkbzYAXnTVVfuL8fhb'),
    '0x2bC16Bf30435fd9B3A3E73Eb759176C77c28308D': new ethers.providers.StaticJsonRpcProvider('https://scroll-mainnet.chainstacklabs.com')
}

const contracts = {
    '0x5d470270e889b61c08C51784cDC73442c4554011': new ethers.Contract('0x5d470270e889b61c08C51784cDC73442c4554011', abi, providers['0x5d470270e889b61c08C51784cDC73442c4554011']),
    '0x2bC16Bf30435fd9B3A3E73Eb759176C77c28308D': new ethers.Contract('0x2bC16Bf30435fd9B3A3E73Eb759176C77c28308D', abi, providers['0x2bC16Bf30435fd9B3A3E73Eb759176C77c28308D'])
}

app.use(express.json())

app.get('/', (req,res) => {
    res.status(200).json({})
})

const toBase58 = (contentHash) => {
    let hex = contentHash.substring(2)
    let buf = multihash.fromHexString(hex);
    return multihash.toB58String(buf);
}

const download = (url, dest, cb) => {
    return new Promise((resolve, reject) => {
        var file = fs.createWriteStream(dest);
        var request = https.get(url, function(response) {
          response.pipe(file);
          file.on('finish', function() {
            file.close(cb);  // close() is async, call cb after close completes.
              resolve()
          });
        }).on('error', function(err) { // Handle errors
          fs.unlink(dest); // Delete the file async. (But we don't check the result)
          if (cb) cb(err.message);
          reject(err)
        });
    })    
  };

app.get('/badge/:filename', cors(), async (req, res) => {
    if (req.params.filename === 'remixer.png' || req.params.filename === 'devconnect_ams.png') {
        res.sendFile('/tmp/' + req.params.filename)
        return
    }
    // badge_0x5d470270e889b61c08C51784cDC73442c4554011_139.png
    const fileName = req.params.filename.replace('.png', '').replace('badge_', '').split('_')
    await apiEndpoint(fileName[0], fileName[1])
    res.sendFile('/tmp/' + req.params.filename)
})

const mainnet = new ethers.providers.StaticJsonRpcProvider(
  'https://mainnet.infura.io/v3/1b3241e53c8d422aab3c7c0e4101de9c',
)
app.get('/ens/:address', cors(), async (req, res) => {
    if (cache['ens_' + req.params.address] && cache['ens_' + req.params.address].queried) {
        res.status(200).json({ name: cache['ens_' + req.params.address].name })
        return
    }
    const name = await mainnet.lookupAddress(req.params.address)
    cache['ens_' + req.params.address] = { name, queried: true }
    res.status(200).json({ name })
})

const fileHashOverrides = {
    'Remixer': 'remixer.png',
    'Devconnector': 'devconnect_ams.png'
}

const resolveBadge = async (contractAddress, id, res) => {
    const chain = chains[contractAddress]
    const provider = providers[contractAddress]
    const contract = contracts[contractAddress]
    
    if (cache[contractAddress + '_' + id]) {
        res && res.status(200).json(cache[contractAddress + '_' + id])
        return 
    }
    
    const data = await contract.tokensData(parseInt(id))
    console.log(data)
    let fileName = 'badge_' + contractAddress + '_' + id + '.png'

    if (fileHashOverrides[data.tokenType]) fileName = fileHashOverrides[data.tokenType]
    const metadata = {
        "name": "remix reward #" + id + " on #" + chain,
        "description": data.tokenType + ' ' + data.payload,
        "image": 'https://remix-reward-api.vercel.app/badge/' + fileName,
        "data": data,
        "attributes": [
            {
                "trait_type": "type",
                "value": data.tokenType
            },{
                "trait_type": "full_type",
                "value": data.tokenType + ' ' + data.payload
            },
        ]
    }
    cache[contractAddress + '_' + id] = metadata
    download('https://ipfs-cluster.ethdevops.io/ipfs/' + toBase58(data.hash), '/tmp/' + fileName, (error, result) => {
        console.error(error, result)
    })
    res && res.status(200).json(metadata)    
}

const warmUp = async (address) => {
    const supply = (await contracts[address].totalSupply()).toNumber()
    console.log('totalSupply', address, supply)
    for (let id = 0; id < supply; id++) {
        await resolveBadge(address, id)
    }
}

app.get('/api/:id', cors(), async (req,res) => {
    // default is Optimism
    await resolveBadge('0x5d470270e889b61c08C51784cDC73442c4554011', req.params.id, res)
})

app.get('/api-optimism/:id', cors(), async (req,res) => {
    // default is Optimism
    await resolveBadge('0x5d470270e889b61c08C51784cDC73442c4554011', req.params.id, res)
})

app.get('/api-scroll/:id', cors(), async (req,res) => {
    // Scroll network    
    await resolveBadge('0x2bC16Bf30435fd9B3A3E73Eb759176C77c28308D', req.params.id, res)
})

app.get('/cache', cors(), async (req,res) => {
    res.status(200).json(cache)
})

const warmup = async () => {
    console.log('warming up...')
    await warmUp('0x5d470270e889b61c08C51784cDC73442c4554011')
    await warmUp('0x2bC16Bf30435fd9B3A3E73Eb759176C77c28308D')
    console.log('warm-up done.')
}

app.get('/warmup', cors(), async (req,res) => {
    warmup()
    res.status(200).json({status: 'started' })
})

app.listen(8888, async () => {
    console.log("listening...")
})

// download the compressed remixer file
download('https://ipfs-cluster.ethdevops.io/ipfs/QmYbt5paBZiy2h4TVV8qHrLodiyqMBeeJXmNJUWyRdrh2D', '/tmp/remixer.png', (error, result) => {
    console.log('remixer download', error, result)
}).catch(console.error).then(console.log)

// download the compressed remixer file
download('https://ipfs-cluster.ethdevops.io/ipfs/QmUaaQWp49LHDdCwzirMdxYbuki6eY9TBPZVvU7ZcQcJKE', '/tmp/devconnect_ams.png', (error, result) => {
    console.log('devconnect_ams download', error, result)
}).catch(console.error).then(console.log)

// Export the Express API
module.exports = app;
