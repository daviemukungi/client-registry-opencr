#!/usr/bin/env node
'use strict';

/**
 * Posts 3 Khmer-script demo patients to the client registry.
 * Patients are designed to appear as "Possible Match" in the
 * Action Required UI (Fellegi-Sunter score ≈ 109.87).
 *
 * Name variations used:
 *   KH-DEMO-001  ចាន់ ស្រីណាត   (canonical form)
 *   KH-DEMO-002  ចាន់ ស្រីនាត   (ណ → ន substitution, common typo)
 *   KH-DEMO-003  ចាន់ ស្រីណា    (shorter given, missing final ត)
 *
 * Usage:
 *   node DemoData/postKhmerDemo.js
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const patients  = require('./khmer_demo_patients.json');
const certsDir  = path.join(__dirname, '../server/clientCertificates');
const serverCert= path.join(__dirname, '../server/serverCertificates/server_cert.pem');

const agent = new https.Agent({
  cert: fs.readFileSync(path.join(certsDir, 'openmrs_cert.pem')),
  key:  fs.readFileSync(path.join(certsDir, 'openmrs_key.pem')),
  ca:   fs.readFileSync(serverCert),
  rejectUnauthorized: false,
});

function postPatient(patient) {
  return new Promise((resolve) => {
    const body = JSON.stringify(patient);
    const req  = https.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/fhir/Patient',
        method: 'POST',
        agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const id  = patient.identifier[0].value;
          const name= patient.name[0].text;
          const dob = patient.birthDate;
          if (res.statusCode === 200 || res.statusCode === 201) {
            let crId = '';
            try { crId = JSON.parse(data).id || ''; } catch {}
            console.log(`✓ ${id}  ${name}  DOB:${dob}  → CR id: ${crId}`);
          } else {
            console.error(`✗ ${id}  HTTP ${res.statusCode}  ${data.slice(0,200)}`);
          }
          resolve();
        });
      }
    );
    req.on('error', (err) => {
      console.error(`✗ ${patient.identifier[0].value}  Error: ${err.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('Posting 3 Khmer demo patients…\n');
  for (const patient of patients) {
    await postPatient(patient);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('\nDone. Open the OpenCR Action Required tab to compare and merge.');
})();
