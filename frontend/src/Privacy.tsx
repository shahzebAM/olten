export default function Privacy() {
  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto', lineHeight: '1.6', color: '#333' }}>
      <h1 style={{ borderBottom: '2px solid #eaeaea', paddingBottom: '10px' }}>Privacy Policy & Terms of Service</h1>
      <p><strong>Effective Date:</strong> September 2, 2026</p>

      <h2 style={{ marginTop: '30px' }}>1. Introduction</h2>
      <p>
        This Privacy Policy applies to the Olten Enterprise Resource Planning (ERP) application ("the App"). The App is intended for internal corporate use to manage personnel, payroll, attendance, and administrative documentation. This policy outlines how we collect, use, and protect your information to comply with Google Play Developer Policies.
      </p>

      <h2 style={{ marginTop: '30px' }}>2. Information We Collect</h2>
      <p>To provide necessary human resources and payroll services, the App collects the following data types directly from administrators or employees:</p>
      <ul style={{ paddingLeft: '20px' }}>
        <li style={{ marginBottom: '8px' }}><strong>Personal & Contact Information:</strong> First name, last name, date of birth, civil status, complete address, and employment status.</li>
        <li style={{ marginBottom: '8px' }}><strong>Financial & Government Identifiers:</strong> Base salary, bank account numbers, total cash advance balances, and government-issued identification numbers (TIN, SSS Number, PhilHealth, Pag-IBIG).</li>
        <li style={{ marginBottom: '8px' }}><strong>Attendance & Device Data:</strong> Time-in and time-out logs. Depending on device permissions, the App may collect coarse or precise location data and IP addresses exclusively to verify physical presence during clock-in/clock-out events.</li>
        <li style={{ marginBottom: '8px' }}><strong>Authentication Data:</strong> Usernames and securely hashed passwords (via bcrypt) for system access.</li>
      </ul>

      <h2 style={{ marginTop: '30px' }}>3. How We Use Your Information</h2>
      <p>We use the collected data strictly for internal corporate functions:</p>
      <ul style={{ paddingLeft: '20px' }}>
        <li style={{ marginBottom: '8px' }}>Calculating gross pay, net pay, standard deductions, overtime, and withholding taxes.</li>
        <li style={{ marginBottom: '8px' }}>Tracking daily employee attendance and enforcing shift schedules.</li>
        <li style={{ marginBottom: '8px' }}>Generating corporate payslips and official financial summary reports.</li>
        <li style={{ marginBottom: '8px' }}>Managing access control and security protocols for system administrators.</li>
      </ul>

      <h2 style={{ marginTop: '30px' }}>4. Data Sharing and Disclosure</h2>
      <p>We do not sell, rent, or trade your personal information. Data is only shared with:</p>
      <ul style={{ paddingLeft: '20px' }}>
        <li style={{ marginBottom: '8px' }}><strong>Cloud Infrastructure Providers:</strong> Data is stored on secure cloud servers necessary to operate the App.</li>
        <li style={{ marginBottom: '8px' }}><strong>Third-Party Integrations:</strong> The App utilizes the Google Drive API strictly for uploading generated AI documents and administrative files to the corporate workspace.</li>
        <li style={{ marginBottom: '8px' }}><strong>Legal Compliance:</strong> We may disclose information if required by law or in response to valid requests by public authorities (e.g., tax audits).</li>
      </ul>

      <h2 style={{ marginTop: '30px' }}>5. Data Security</h2>
      <p>
        We implement robust security measures to protect your data. All database connections require secure environments, and authentication relies on encrypted password hashing. Access is strictly governed by Super Admin permissions.
      </p>

      <h2 style={{ marginTop: '30px' }}>6. Data Retention and Deletion</h2>
      <p>
        We retain employee and payroll data as long as the employee is active or as required by corporate tax laws. Users with appropriate permissions can manually delete employee records, attendance logs, and payroll histories directly within the App's interface.
      </p>
    </div>
  );
}