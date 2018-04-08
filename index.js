require('dotenv').config()
require('isomorphic-fetch')
const http = require('http')
const axios = require('axios')
const Dropbox = require('dropbox').Dropbox


const hostname = process.env.HOST
const port = process.env.PORT
const rateApiKey = process.env.RATE_API_KEY
const dbxToken = process.env.DBX_TOKEN
const filePath = process.env.FILE_PATH

var api = axios.create({
  baseURL: 'https://openexchangerates.org/api/',
  timeout: 10000,
  params: {
    app_id: rateApiKey
  }
})
var dbx = new Dropbox({ accessToken: dbxToken })
var year = null
var month = null

async function asyncCall() {
  let binary = await getFileBinary()
  if (dateAlreadyAdded(binary)) {
    return Promise.reject(`The data for this date (${month}/${year}) has already been added`)
  }
  let eurConv = await getEURConv()
  let toWrite = encodeConv(eurConv)
  let newBinary = createNewBinary(binary, toWrite)
  let fileUpdated = await setFileBinary(newBinary)
  return fileUpdated
}

const server = http.createServer((req, res) => {
  // match /add/yyyy-MM/
  const regex = /^\/add\/(\d{4})-(\d{2})\/?$/;
  let m = regex.exec(req.url)
  let resObj = null
  if (m !== null) {
    year = m[1]
    month = m[2]
    res.setHeader('Content-Type', 'application/json')
    asyncCall().then(function (value) {
      res.statusCode = 200
      console.log(`success for ${month}/${year}`)
      res.end(JSON.stringify({message:`File '${value}' succesfully updated with exchange data for ${month}/${year}`}))
    }).catch(function (e) {
      res.statusCode = 400
      console.log('error: ' + JSON.stringify(e))
      res.end(JSON.stringify({error:e}))
    })
  } else {
    res.statusCode = 401
    res.end(JSON.stringify({error: `could not match ${req.url} (format: /add/yyyy-MM/`}))
  }
})

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`)
});

async function getEURConv () {
  let response = await api.get(`/historical/${year}-${month}-01.json`)
//  let response = {data:{rates:{USD:1, EUR:1.5, CAD:0.7}}}
  let rates = response.data.rates
  let eurRate = rates.EUR
  Object.keys(rates).map(function (key, index) {
    rates[key] = Math.round(100*rates[key]/eurRate)/100
  })
  return rates
}

async function getFileBinary () {
  response = await dbx.filesDownload({
    path: filePath
  })
  return response && response.fileBinary
}

async function setFileBinary (binary) {
  response = await dbx.filesUpload({
    contents:binary,
    path:filePath,
    mode:{
      '.tag':'overwrite'
    }
  })
  return response && response.path_display
}

function encodeConv (conv) {
  let result = ''
  Object.keys(conv).map(function (key,index) {
    result += `${year}${month},${key},${conv[key]}\n`
  })
  return result
}

function createNewBinary (oldBinary, newText) {
  let newTextBuf = Buffer.from(newText)
  return Buffer.concat([oldBinary, newTextBuf])
}

function dateAlreadyAdded (binary) {
  return binary.toString().includes(`${year}${month}`)
}
