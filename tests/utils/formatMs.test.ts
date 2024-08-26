import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import { initEccLib } from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import { miniscript } from "../../src/utils/formatMs";

describe("formatMs", () => {
  initEccLib(ecc);
  const ECPair = ECPairFactory(ecc);

  function pk33() {
    return ECPair.makeRandom().publicKey;
  }

  function pk32() {
    return pk33().subarray(1);
  }

  it("formats ms", () => {
    const pk1 = pk32();
    const pk2 = pk32();
    const pk3 = pk32();
    expect(miniscript`pk(${pk1})`.toString()).toBe(
      `pk(${pk1.toString("hex")})`,
    );
    expect(
      miniscript`
      pk(
        ${pk1}
      )`.toString(),
    ).toBe(`pk(${pk1.toString("hex")})`);

    const msMulti = miniscript`multi_a(2, ${pk1}, ${pk2}, ${pk3})`;
    expect(msMulti.toString()).toBe(
      `multi_a(2,${pk1.toString("hex")},${pk2.toString("hex")},${pk3.toString(
        "hex",
      )})`,
    );
    expect(miniscript`multi_a(2, ${[pk1, pk2, pk3]})`.toString()).toBe(
      msMulti.toString(),
    );
  });
});
