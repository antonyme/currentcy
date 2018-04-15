require('dotenv').config()
require('isomorphic-fetch')
const util = require('util')
const http = require('http')
const axios = require('axios')
const Confirm = require('prompt-confirm')
const Dropbox = require('dropbox').Dropbox

// load .env config and secrets
const nodeEnv = process.env.NODE_ENV || "development"
const hostname = process.env.HOST
const port = process.env.PORT
const baseRate = process.env.BASE_RATE
const rateApiKey = process.env.RATE_API_KEY
const dbxToken = process.env.DBX_TOKEN
const filePath = nodeEnv === "production" ? process.env.FILE_PATH : process.env.DEV_FILE_PATH

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
  get toST1 () {return `${this.year}-${this.month}`}
  get toST2 () {return `${this.year}${this.month}`}
}
var resultsLog = []
var shouldPause = false

// get script parameter
switch (process.argv.length) {
  case 3: {
    if (process.argv[2] == "serv") {          // currentcy.js serv
      startServer()
    } else if (process.argv[2] == "script") { // currentcy.js script
      let now = new Date()
      let date = new monthDate(now.getFullYear(), pad(now.getMonth() + 1))
      runScript([date])
    } else formatError()
    break;
  }
  case 4: {                                    // currentcy.js script 2015-01
    let match = /^(\d{4})-(\d{2})$/.exec(process.argv[3])
    if (match != null) {
      let date = new monthDate(match[1], match[2])
      runScript([date])
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
      shouldPause = true
      runScript(datesToDo)
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
      resultsLog = []
      res.setHeader('Content-Type', 'application/json')
      addDataForDates([date]).then(function (nbDates) {
        res.statusCode = 200
        console.log(`Success: exchange rates added to ${filePath}`)
        res.end(JSON.stringify({Success: `exchange rates for ${date.toST1} added to ${filePath}`}))
      }).catch(function (e) {
        res.statusCode = 400
        if (e == 400) {
          console.log(`Nothing to add, ${filePath} was not modified`)
          res.end(JSON.stringify({Error:resultsLog[0].msg}))
        } else {
          console.log('Error: ' + util.inspect(e))
          res.end(JSON.stringify({Error:e}))
        }
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
  addDataForDates(date).then(function (nbDates) {
    console.log(`Success: exchange rates for ${nbDates} date(s) added to ${filePath}`)
  }).catch(function (e) {
    if (e == 400) {
      console.log(`Nothing to add, ${filePath} was not modified`)
    } else if (e == 401) {
      console.log(`Results not saved, ${filePath} was not modified`)
    } else {
      console.log('Error: ' + util.inspect(e))
    }
  })
}

async function addDataForDates (datesToDo) {
  let binary = await getFileBinary()
  let filteredDatesToDo = filterDatesToDo(datesToDo, binary)
  let eurConvTab = await Promise.all(filteredDatesToDo.map(getEURConv))
  eurConvTab = eurConvTab.filter(p => p) // remove null values from API fails
  printResultLog()
  if (eurConvTab.length == 0) return Promise.reject(400) // nothing to add
  if (shouldPause) {
    let save = await askConfirmation()
    if (!save) return Promise.reject(401) // user refused to save
  }
  let toWrite = eurConvTab.map(encodeConv).join('')
  let newBinary = createNewBinary(binary, toWrite)
  let fileUpdated = await setFileBinary(newBinary)
  return eurConvTab.length
}

async function getEURConv (date) {
  let response = null
  function fakeAPI () {
    return new Promise(resolve => {
      setTimeout(() => {
        if (Math.random() > 0.5) {
          resultsLog.push({date:date.toST1, qt:3, msg:"OK"})
          resolve({date:date,data:{EUR:1, USD:parseInt(date.year), DBS:parseInt(date.month)}})
        } else {
          resultsLog.push({date:date.toST1, qt:0, msg:"API Error"})
          resolve(null)
        }
      }, Math.random()*1000)
    })
  }
  function trueAPI() {
    return new Promise((resolve,reject) => {
      api.get(`/historical/` + date.toST1 + `-01.json`).then(response => {
        let rates = response.data.rates
        resultsLog.push({date:date.toST1, qt:Object.keys(rates).length, msg:"OK"})
        // Convert USD based rates to the base configured in .env
        Object.keys(rates).map(function (key, index) {
          rates[key] = (rates[key]/rates[baseRate]).toPrecision(6)
        })
        resolve({date:date, data:rates})
      }).catch(error => {
        if (error.response && error.response.data.message) {
          let message = error.response.data.message
          resultsLog.push({date:date.toST1, qt:0, msg:`API Error: ${message}`})
          resolve(null)
        } else if (error.response) {
          reject(error)
        } else if (error.request) {
          resultsLog.push({date:date.toST1, qt:0, msg:"Network Error"})
          resolve(null)
        } else {
          reject(error)
        }
      })
    })
  }
  return (nodeEnv === "production") ? (await trueAPI()) : (await fakeAPI())
}

function printResultLog () {
  resultsLog.sort((a, b) => a.date > b.date ? 1 : -1)
  console.log('Data retreived:')
  console.log('Date\t\t Quantity\t Info')
  resultsLog.forEach(res => console.log(res.date, '\t', res.qt, '\t\t', res.msg))
}

function askConfirmation () {
  prompt = new Confirm('Save results?')
  return prompt.run()
}

async function getFileBinary () {
  let response
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

function filterDatesToDo (datesToDo, binary) {
  return datesToDo.filter(date => {
    if(dateAlreadyAdded(date, binary)) {
      resultsLog.push({
        date: date.toST1,
        qt: 0,
        msg: 'date already in file'
      })
      return false
    } else return true
  });
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

function encodeConv (convYear) {
  let result = ''
  Object.keys(convYear.data).map(function (key,index) {
    result += `${convYear.date.toST2},${key},${convYear.data[key]}\n`
  })
  return result
}

function createNewBinary (oldBinary, newText) {
  let newTextBuf = Buffer.from(newText)
  return Buffer.concat([oldBinary, newTextBuf])
}

function dateAlreadyAdded (date, binary) {
  return binary.toString().includes(date.toST2 + `,`)
}

function pad(n){
  return n<10 ? '0' + n : n
}
