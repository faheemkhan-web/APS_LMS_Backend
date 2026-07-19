const http = require('http');

const BASE_URL = 'http://127.0.0.1:5000/api';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING SYSTEM INTEGRATION TESTS (NATIVE HTTP MODULE) ---');

  const testEmail = 'test_student_' + Math.random().toString(36).substr(2, 5) + '@lms.com';
  const testPassword = 'password123';
  const testName = 'Automated Test Student';

  try {
    // 1. Sign Up Student
    console.log(`\nStep 1: Registering student: ${testEmail}...`);
    const registerRes = await request('POST', '/auth/register', {
      name: testName,
      email: testEmail,
      password: testPassword
    });
    
    if (registerRes.status === 201 && registerRes.data.user.status === 'pending') {
      console.log('✓ Success: Registration submitted and status set to "pending".');
    } else {
      throw new Error(`Unexpected registration response: ${JSON.stringify(registerRes.data)}`);
    }

    const tempUserId = registerRes.data.user.id;

    // 2. Attempt Login as Pending Student (Should fail with 403)
    console.log('\nStep 2: Attempting to login as pending student (should be blocked)...');
    const loginFailRes = await request('POST', '/auth/login', {
      email: testEmail,
      password: testPassword
    });

    if (loginFailRes.status === 403) {
      console.log(`✓ Success: Login blocked with message: "${loginFailRes.data.message}"`);
    } else {
      throw new Error(`Unexpected status on login: ${loginFailRes.status}. Data: ${JSON.stringify(loginFailRes.data)}`);
    }

    // 3. Admin Login
    console.log('\nStep 3: Logging in as administrator...');
    const adminLoginRes = await request('POST', '/auth/login', {
      email: 'admin@lms.com',
      password: 'admin123'
    });

    if (adminLoginRes.status === 200 && adminLoginRes.data.token) {
      console.log('✓ Success: Admin logged in successfully.');
    } else {
      throw new Error(`FAIL: Admin login failed. Data: ${JSON.stringify(adminLoginRes.data)}`);
    }

    const adminToken = adminLoginRes.data.token;

    // 4. Verify Student is in Pending list
    console.log('\nStep 4: Admin fetches students list...');
    const studentsRes = await request('GET', '/admin/students', null, {
      Authorization: `Bearer ${adminToken}`
    });

    const foundStudent = studentsRes.data.find(s => s.id === tempUserId);
    if (foundStudent && foundStudent.status === 'pending') {
      console.log(`✓ Success: Found student '${foundStudent.name}' in list with pending status.`);
    } else {
      throw new Error(`FAIL: Student not found in admin list or has wrong status: ${JSON.stringify(studentsRes.data)}`);
    }

    // 5. Admin Approves Student
    console.log(`\nStep 5: Admin approving student ID: ${tempUserId}...`);
    const approveRes = await request('PUT', `/admin/students/${tempUserId}/approve`, null, {
      Authorization: `Bearer ${adminToken}`
    });
    
    if (approveRes.status === 200) {
      console.log(`✓ Success: Approved student. Response: "${approveRes.data.message}"`);
    } else {
      throw new Error(`FAIL: Could not approve student. Data: ${JSON.stringify(approveRes.data)}`);
    }

    // 6. Login again as Approved Student (Should succeed)
    console.log('\nStep 6: Login as approved student...');
    const studentLoginRes = await request('POST', '/auth/login', {
      email: testEmail,
      password: testPassword
    });

    if (studentLoginRes.status === 200 && studentLoginRes.data.token) {
      console.log(`✓ Success: Student logged in successfully. Token: ${studentLoginRes.data.token.substr(0, 15)}...`);
    } else {
      throw new Error(`FAIL: Login failed for approved student: ${JSON.stringify(studentLoginRes.data)}`);
    }

    // 7. Cleanup: Delete test student
    console.log('\nStep 7: Cleaning up database, removing test student...');
    const deleteRes = await request('DELETE', `/admin/students/${tempUserId}`, null, {
      Authorization: `Bearer ${adminToken}`
    });
    
    if (deleteRes.status === 200) {
      console.log(`✓ Success: Deleted test student. Response: "${deleteRes.data.message}"`);
    } else {
      throw new Error(`FAIL: Could not delete test student. Data: ${JSON.stringify(deleteRes.data)}`);
    }

    console.log('\n--- ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ---');
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    process.exit(1);
  }
}

runTests();
