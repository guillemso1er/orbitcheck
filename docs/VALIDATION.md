5 JSON objects representing the spectrum of address validity, ranging from complete garbage data to a verified, real-world location.

### 1. Completely Invalid (Garbage Data)
This represents inputs often seen during fuzz testing or spam bot submissions. It ignores format, length constraints, and logic.
```json
{
  "address": {
    "line1": "undefined",
    "line2": "null",
    "city": "123456",
    "state": "!!ERROR!!",
    "postal_code": "NaN",
    "country": "XX"
  }
}
```

### 2. Syntactically Valid but Fictional (Placeholder)
This data respects the string format but contains obvious placeholder text or "dummy" data used by developers.
```json
{
  "address": {
    "line1": "1234 Example Street",
    "line2": "Suite 000",
    "city": "Testville",
    "state": "Demo State",
    "postal_code": "99999",
    "country": "Nowhere Land"
  }
}
```

### 3. Geographically Plausible but Non-Existent
This uses a real city and state with a valid zip code format, but the street address is made up. It passes basic validation filters but would fail a delivery attempt.
```json
{
  "address": {
    "line1": "80000 Unicorn Boulevard",
    "line2": "Apt 4B",
    "city": "Chicago",
    "state": "IL",
    "postal_code": "60601",
    "country": "USA"
  }
}
```

### 4. Real Location (Famous/Historical)
This is a real physical street in a real city. It is a "valid" address, though it is often used as an edge case because it is a landmark or museum rather than a standard residence.
```json
{
  "address": {
    "line1": "221B Baker Street",
    "line2": "",
    "city": "London",
    "state": "Greater London",
    "postal_code": "NW1 6XE",
    "country": "United Kingdom"
  }
}
```
This address represents a Real Location (High Profile/Restricted). Like the Sherlock Holmes example, this address physically exists and is perfectly formatted. However, it is an edge case because it is often used by users who do not want to provide their real data, leading many systems to flag it as "suspicious" or "fraudulent" despite its validity. It also possesses a unique ZIP code assigned to a single building.
```json
{
  "address": {
    "line1": "1600 Pennsylvania Avenue NW",
    "line2": "",
    "city": "Washington",
    "state": "DC",
    "postal_code": "20500",
    "country": "USA"
  }
}

### 5. Actually Existing (Verifiable & Shippable)
This is a 100% correct, fully existing address (Google's Headquarters) that will pass all verification APIs and can successfully receive mail.
```json
{
  "address": {
    "line1": "1600 Amphitheatre Parkway",
    "line2": "",
    "city": "Mountain View",
    "state": "CA",
    "postal_code": "94043",
    "country": "USA"
  }
}
```