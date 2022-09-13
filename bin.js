#!/usr/bin/env node

import IPFSClient from './distribution/index.js';

const command = process.argv.slice(2, 3)
const input = process.argv.slice(3)

const ipfsClient = new IPFSClient();
await ipfsClient.init();

if (!command.length || command[0] !== 'read') {
  console.log('Expected `read` for first argument')
  process.exit()
}
if (!input.length) {
  console.log('Expected `ipfs://{cid}` for second argument')
  process.exit()
}

const result = await ipfsClient[command[0]](input[0])
console.log(result)