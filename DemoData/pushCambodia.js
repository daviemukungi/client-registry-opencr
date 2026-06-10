const https = require('https');
const fs = require('fs');
const path = require('path');
const patients = require('./MCH_Patient_FHIR_Resources.json');

const certsDir = path.join(__dirname, '../server/clientCertificates');
const serverCert = path.join(__dirname, '../server/serverCertificates/server_cert.pem');

const agentOptions = {
  cert: fs.readFileSync(path.join(certsDir, 'openmrs_cert.pem')),
  key: fs.readFileSync(path.join(certsDir, 'openmrs_key.pem')),
  ca: fs.readFileSync(serverCert),
  rejectUnauthorized: false,
};
const agent = new https.Agent(agentOptions);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postPatient = (patient) => {
  return new Promise((resolve) => {
    const body = JSON.stringify(patient);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/fhir/Patient',
      method: 'POST',
      timeout: 30000,
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(options, (res) => {
      res.resume();
      console.log(res.statusCode, JSON.stringify(patient.identifier));
      resolve();
    });
    req.on('error', (err) => {
      console.error('Error:', err.message, JSON.stringify(patient.identifier));
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      console.error('Timeout', JSON.stringify(patient.identifier));
      resolve();
    });
    req.write(body);
    req.end();
  });
};

(async () => {
  console.log(`Uploading ${patients.length} patients...`);
  let i = 0;
  for (const patient of patients) {
    i++;
    await postPatient(patient);
    await delay(300);
    if (i % 10 === 0) console.log(`Progress: ${i}/${patients.length}`);
  }
  console.log('Done');
})();
