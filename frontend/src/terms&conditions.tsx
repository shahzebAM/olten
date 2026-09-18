export default function Terms() {
  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto', lineHeight: '1.6', color: '#333' }}>
      <h1 style={{ borderBottom: '2px solid #eaeaea', paddingBottom: '10px' }}>Terms of Service</h1>
      <p><strong>Effective Date:</strong> September 18, 2026</p>

      <h2 style={{ marginTop: '30px' }}>1. Acceptance of Terms</h2>
      <p>
        By accessing and using the Olten Enterprise Resource Planning (ERP) application ("the App"), you accept and agree to be bound by the terms and provision of this agreement. The App is intended strictly for authorized internal corporate use by approved personnel only.
      </p>

      <h2 style={{ marginTop: '30px' }}>2. User Accounts and Security</h2>
      <p>
        Access to the App is provisioned by system administrators. You are entirely responsible for maintaining the confidentiality of your account credentials (username and password). You agree to accept full responsibility for any and all activities or actions that occur under your account.
      </p>

      <h2 style={{ marginTop: '30px' }}>3. Acceptable Use Policy</h2>
      <p>Users must utilize the App solely for its intended administrative, payroll, inventory, and document management purposes. You explicitly agree NOT to:</p>
      <ul style={{ paddingLeft: '20px' }}>
        <li style={{ marginBottom: '8px' }}>Modify, alter, or falsify payroll, attendance, order slips, or inventory records without official authorization.</li>
        <li style={{ marginBottom: '8px' }}>Use the App for any illegal, unauthorized, or maliciously intended purpose.</li>
        <li style={{ marginBottom: '8px' }}>Attempt to bypass, disable, or compromise the App's access controls or security measures.</li>
      </ul>

      <h2 style={{ marginTop: '30px' }}>4. Third-Party Integrations and Google APIs</h2>
      <p>
        The App integrates with third-party services, specifically Google Drive and Google AI (Gemini), to facilitate corporate document storage, analysis, and retrieval. By utilizing these features, you acknowledge and agree to be bound by Google's respective Terms of Service. The App's use and transfer of information received from Google APIs to any other app will adhere strictly to the Google API Services User Data Policy, including the Limited Use requirements.
      </p>

      <h2 style={{ marginTop: '30px' }}>5. Intellectual Property</h2>
      <p>
        The App, including its original source code, features, logic algorithms, user interface, and functionality, is exclusively owned by the Company and is protected by international copyright, trademark, and other intellectual property or proprietary rights laws.
      </p>

      <h2 style={{ marginTop: '30px' }}>6. Termination of Access</h2>
      <p>
        System administrators (Super Admins) reserve the right to terminate, restrict, or suspend your access to the App immediately, without prior notice or liability, for any reason whatsoever, including but not limited to a breach of these Terms.
      </p>

      <h2 style={{ marginTop: '30px' }}>7. Limitation of Liability</h2>
      <p>
        The App is provided on an "AS IS" and "AS AVAILABLE" basis for internal corporate processing. In no event shall the developers, directors, employees, or agents be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to, use of, or inability to access the App.
      </p>
    </div>
  );
}