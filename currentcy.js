require('dotenv').config()
require('isomorphic-fetch')
const util = require('util')
const http = require('http')
const axios = require('axios')
const Dropbox = require('dropbox').Dropbox

// load .env config and secrets
const hostname = process.env.HOST
const port = process.env.PORT
const rateApiKey = process.env.RATE_API_KEY
const dbxToken = process.env.DBX_TOKEN
const filePath = process.env.FILE_PATH

// app variables
var api = axios.create({
  baseURL: 'https://openexchangerates.org/api/',
  timeout: 10000,
  params: {
    app_id: rateApiKey
  }
})
var dbx = new Dropbox({ accessToken: dbxToken })
class monthDate {
  constructor(year, month) {
    this.year = year.toString();
    this.month = month.toString();
  }

  toST1() {
    return `${this.year}-${this.month}`
  }

  toST2() {
    return `${this.year}${this.month}`
  }
}

// get script parameter
switch (process.argv.length) {
  case 3: {
    if (process.argv[2] == "serv") {          // currentcy.js serv
      startServer()
    } else if (process.argv[2] == "script") { // currentcy.js script
      let now = new Date()
      let date = new monthDate(now.getFullYear(), pad(now.getMonth() + 1))
      runScript(date)
    } else formatError()
    break;
  }
  case 4: {                                    // currentcy.js script 2015-01
    let match = /^(\d{4})-(\d{2})$/.exec(process.argv[3])
    if (match != null) {
      let date = new monthDate(match[1], match[2])
      runScript(date)
    } else formatError()
    break;
  }
  case 5: {                                    // currentcy.js script 2015-01 2018-04
    let regex = /^(\d{4})-(\d{2})$/
    let matchStart = regex.exec(process.argv[3])
    let matchEnd = regex.exec(process.argv[4])
    if (matchStart != null &&
        matchEnd != null) {
      let datesToDo = []
      let year = matchStart[1]
      let month = matchStart[2]
      while(year < matchEnd[1] || month <= matchEnd[2]) {
        datesToDo.push(new monthDate(year, month))
        month = pad((parseInt(month) % 12) + 1)
        year = month == 1 ? parseInt(year) + 1 : year
      }
      addDataForDates(datesToDo).then(function (nbLines) {
        console.log(`Success: ${nbLines} exchange rates added to ${filePath}`)
      }).catch(function (e) {
        console.log('Error: ' + util.inspect(e))
      })
    } else formatError()
    break;
  }
  default: {
    formatError()
    break;
  }
}

function formatError () {
  console.error('Format not reconized\n \
    Usage:\n\
    \tcurrentcy.js serv\n\
    \tcurrentcy.js script\n\
    \tcurrentcy.js script 2015-01\n\
    \tcurrentcy.js script 2015-01 2018-04')
}

function startServer () {
  const server = http.createServer((req, res) => {
    // match '/add/yyyy-MM'
    let regex = /^\/add\/(\d{4})-(\d{2})\/?$/
    let match = regex.exec(req.url)
    let resObj = null
    if (match !== null) {
      date = new monthDate(match[1], match[2])
      res.setHeader('Content-Type', 'application/json')
      addDataForDate(date).then(function (nbLines) {
        res.statusCode = 200
        console.log(`Success: ${nbLines} exchange rates added to ${filePath} for ${date.toST1()}}`)
        res.end(`{"Success": "${nbLines} exchange rates added to ${filePath} for ${date.toST1()}"}`)
      }).catch(function (e) {
        res.statusCode = 400
        console.log('Error: ' + util.inspect(e))
        res.end(JSON.stringify({Error:e}))
      })
    } else {
      res.statusCode = 401
      res.end(`{"Error": could not match ${req.url} (format: /add/yyyy-MM/}`)
    }
  })

  server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`)
  });
}

function runScript (date) {
  console.log('run for ', date.toST1())
  addDataForDate(date).then(function (nbLines) {
    console.log(`Success: ${nbLines} exchange rates added to ${filePath} for ` + date.toST1())
  }).catch(function (e) {
    console.log('Error: ' + util.inspect(e))
  })
}

async function addDataForDate (dateToDo) {
  return await addDataForDates([dateToDo])
}

async function addDataForDates (datesToDo) {
  let binary = await getFileBinary()
  let filteredDatesToDo = datesToDo.filter(date => {
    if(dateAlreadyAdded(date, binary)) {
      console.log(date.toST1() + ` has already been added`)
      return false
    } else return true
  });
  let eurConvTab = await Promise.all(filteredDatesToDo.map(getEURConv))
  let toWrite = filteredDatesToDo.map((obj, idx) => encodeConv(obj, eurConvTab[idx])).join('')
  let newBinary = createNewBinary(binary, toWrite)
  let fileUpdated = await setFileBinary(newBinary)
  return eurConvTab.reduce((acc,cur) => acc + Object.keys(cur).length, 0)
}

async function getEURConv (date) {
  let response = null
  function fakeAPI () {
    return new Promise(resolve => {
      setTimeout(() => {
        console.log('got data for ', date.toST1())
        resolve({EUR:1, USD:parseInt(date.year), DBS: parseInt(date.month)})
      }, Math.random()*1000)
    })
  }
  return await fakeAPI()
  // try {
  //   response = await api.get(`/historical/` + date.toST1() + `-01.json`)
  // } catch (e) {
  //   if(e.response.status == 400) {
  //     return Promise.reject(e.response.data)
  //   } else {
  //     return Promise.reject(e)
  //   }
  // }
  // let rates = response.data.rates
  // // Convert USD based rates to EUR based
  // let eurRate = rates.EUR
  // Object.keys(rates).map(function (key, index) {
  //   rates[key] = (rates[key]/eurRate).toPrecision(6)
  // })
  // return rates
}

async function getFileBinary () {
  try {
    response = await dbx.filesDownload({
      path: filePath
    })
  }
  catch (e) {
    if(e.status == 409) {
      console.log('File does not exist, it will be created')
      return Buffer.alloc(0)
    } else {
      return Promise.reject(e)
    }
  }
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

function encodeConv (date, conv) {
  let result = ''
  Object.keys(conv).map(function (key,index) {
    result += date.toST2() + `,${key},${conv[key]}\n`
  })
  return result
}

function createNewBinary (oldBinary, newText) {
  let newTextBuf = Buffer.from(newText)
  return Buffer.concat([oldBinary, newTextBuf])
}

function dateAlreadyAdded (date, binary) {
  return binary.toString().includes(date.toST2() + `,`)
}

function pad(n){
  return n<10 ? '0' + n : n
}
