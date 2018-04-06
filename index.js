require('dotenv').config()
const http = require('http')
const axios = require('axios')


const hostname = process.env.HOST
const port = process.env.PORT
const rateApiKey = process.env.RATE_API_KEY

var api = axios.create({
  baseURL: 'https://openexchangerates.org/api/',
  timeout: 10000,
  params: {
    app_id: rateApiKey
  }
})

const server = http.createServer((req, res) => {
  api.get(`/historical${req.url}-01.json`)
    .then(function (response) {
      console.log({
        status: response.status
      })
      res.setHeader('Content-Type', response.headers['content-type'])
      res.statusCode = response.status
      res.end(JSON.stringify(response.data))
    }).catch (function (e) {
      console.log(e)
    })
})

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`)
});
