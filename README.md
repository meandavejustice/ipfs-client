# IPFS-Client

:caution: work in progress :caution:

``` javascript

import IpfsClient from 'ipfs-client';

const ipfsClient = new IpfsClient();
await ipfsClient.init();

const myFile = await ipfsClient.read('ipfs://bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va');
console.log(myFile);
```


``` shell

node bin.js readp ipfs://bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va
```
