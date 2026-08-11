/*
  Blink — smoke-test sketch for arduino-mcp compile/upload.
  Compatible with Arduino Uno (arduino:avr:uno).
*/

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("blink-high");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("blink-low");
  delay(500);
}
