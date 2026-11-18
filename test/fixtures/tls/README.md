# Test certificates

Throwaway certificates for the tests only, never used anywhere else:

- `ca.pem`: a test authority standing in for the Overkiz root CA (its key
  was deleted after signing);
- `box-1234-5678-9012.*`: the fake box of the tests, `CN=gateway-1234-5678-9012.local`,
  signed by `ca.pem`;
- `box-9999-8888-7777.*`: another box, signed by `ca.pem` (wrong box);
- `rogue.*`: self-signed with the right name, not signed by `ca.pem`.

Made with OpenSSL (RSA 2048, valid 100 years).
