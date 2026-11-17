package cn.bg7qvu.htisw.ecashier;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bouncycastle.asn1.ASN1Integer;
import org.bouncycastle.asn1.ASN1OctetString;
import org.bouncycastle.asn1.ASN1Sequence;
import org.bouncycastle.asn1.DEROctetString;
import org.bouncycastle.asn1.DERSequence;
import org.bouncycastle.asn1.pkcs.PrivateKeyInfo;
import org.bouncycastle.asn1.x509.SubjectPublicKeyInfo;
import org.bouncycastle.crypto.CipherParameters;
import org.bouncycastle.crypto.digests.SM3Digest;
import org.bouncycastle.crypto.engines.SM2Engine;
import org.bouncycastle.crypto.params.ParametersWithID;
import org.bouncycastle.crypto.params.ParametersWithRandom;
import org.bouncycastle.crypto.signers.SM2Signer;
import org.bouncycastle.crypto.util.PrivateKeyFactory;
import org.bouncycastle.crypto.util.PublicKeyFactory;
import org.bouncycastle.util.BigIntegers;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;

final class WireCrypto {
    private static final byte[] ID = ascii("1234567812345678");
    private static final Base64.Encoder B64 = Base64.getEncoder();
    private final SecureRandom random = new SecureRandom();
    private final CipherParameters ownKey;
    private final CipherParameters peerKey;

    WireCrypto(Path privateKey, Path backendPublicKey) throws IOException {
        ownKey = PrivateKeyFactory.createKey(PrivateKeyInfo.getInstance(pem(privateKey, "PRIVATE KEY")));
        peerKey = PublicKeyFactory.createKey(SubjectPublicKeyInfo.getInstance(pem(backendPublicKey, "PUBLIC KEY")));
    }

    JsonObject seal(JsonObject payload, String purpose) throws Exception {
        byte[] key = random.generateSeed(32);
        byte[] iv = random.generateSeed(12);
        Cipher aes = aes(Cipher.ENCRYPT_MODE, purpose, key, iv);
        byte[] combined = aes.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));
        int split = combined.length - 16;
        JsonObject envelope = new JsonObject();
        envelope.addProperty("key", B64.encodeToString(wrap(key)));
        envelope.addProperty("iv", B64.encodeToString(iv));
        envelope.addProperty("tag", B64.encodeToString(Arrays.copyOfRange(combined, split, combined.length)));
        envelope.addProperty("data", B64.encodeToString(Arrays.copyOf(combined, split)));
        SM2Signer signer = new SM2Signer();
        signer.init(true, new ParametersWithID(new ParametersWithRandom(ownKey, random), ID));
        byte[] message = message(envelope, purpose);
        signer.update(message, 0, message.length);
        envelope.addProperty("signature", B64.encodeToString(signer.generateSignature()));
        return envelope;
    }

    JsonObject open(JsonObject envelope, String purpose) throws Exception {
        SM2Signer verifier = new SM2Signer();
        verifier.init(false, new ParametersWithID(peerKey, ID));
        byte[] message = message(envelope, purpose);
        verifier.update(message, 0, message.length);
        if (!verifier.verifySignature(decode(envelope, "signature"))) {
            throw new IOException("Invalid SM2 signature");
        }
        byte[] key = unwrap(decode(envelope, "key"));
        byte[] iv = decode(envelope, "iv");
        byte[] tag = decode(envelope, "tag");
        byte[] data = decode(envelope, "data");
        if (iv.length != 12 || tag.length != 16 || key.length != 32) {
            throw new IOException("Invalid envelope sizes");
        }
        byte[] combined = Arrays.copyOf(data, data.length + tag.length);
        System.arraycopy(tag, 0, combined, data.length, tag.length);
        byte[] plaintext = aes(Cipher.DECRYPT_MODE, purpose, key, iv).doFinal(combined);
        return JsonParser.parseString(new String(plaintext, StandardCharsets.UTF_8)).getAsJsonObject();
    }

    private byte[] wrap(byte[] key) throws Exception {
        SM2Engine sm2 = new SM2Engine(SM2Engine.Mode.C1C3C2);
        sm2.init(true, new ParametersWithRandom(peerKey, random));
        byte[] wrapped = sm2.processBlock(key, 0, key.length);
        return new DERSequence(new org.bouncycastle.asn1.ASN1Encodable[]{
            new ASN1Integer(new java.math.BigInteger(1, Arrays.copyOfRange(wrapped, 1, 33))),
            new ASN1Integer(new java.math.BigInteger(1, Arrays.copyOfRange(wrapped, 33, 65))),
            new DEROctetString(Arrays.copyOfRange(wrapped, 65, 97)),
            new DEROctetString(Arrays.copyOfRange(wrapped, 97, wrapped.length))
        }).getEncoded();
    }

    private byte[] unwrap(byte[] wrapped) throws Exception {
        ASN1Sequence sequence = ASN1Sequence.getInstance(wrapped);
        byte[] x = BigIntegers.asUnsignedByteArray(32, ASN1Integer.getInstance(sequence.getObjectAt(0)).getValue());
        byte[] y = BigIntegers.asUnsignedByteArray(32, ASN1Integer.getInstance(sequence.getObjectAt(1)).getValue());
        byte[] hash = ASN1OctetString.getInstance(sequence.getObjectAt(2)).getOctets();
        byte[] data = ASN1OctetString.getInstance(sequence.getObjectAt(3)).getOctets();
        if (sequence.size() != 4 || hash.length != 32 || data.length != 32) {
            throw new IOException("Invalid SM2 ciphertext");
        }
        byte[] bytes = new byte[129];
        bytes[0] = 4;
        System.arraycopy(x, 0, bytes, 1, 32);
        System.arraycopy(y, 0, bytes, 33, 32);
        System.arraycopy(hash, 0, bytes, 65, 32);
        System.arraycopy(data, 0, bytes, 97, 32);
        SM2Engine sm2 = new SM2Engine(SM2Engine.Mode.C1C3C2);
        sm2.init(false, ownKey);
        return sm2.processBlock(bytes, 0, bytes.length);
    }

    static String fingerprint(String value) {
        byte[] message = ascii(value);
        byte[] digest = new byte[32];
        SM3Digest hash = new SM3Digest();
        hash.update(message, 0, message.length);
        hash.doFinal(digest, 0);
        return HexFormat.of().formatHex(digest);
    }

    private static Cipher aes(int mode, String purpose, byte[] key, byte[] iv) throws Exception {
        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        aes.updateAAD(ascii(purpose));
        return aes;
    }

    private static byte[] message(JsonObject e, String purpose) {
        return ascii(String.join("\n", "HTISW1", purpose, e.get("key").getAsString(), e.get("iv").getAsString(),
            e.get("tag").getAsString(), e.get("data").getAsString()));
    }

    private static byte[] pem(Path path, String type) throws IOException {
        String text = Files.readString(path);
        return Base64.getMimeDecoder().decode(text.replace("-----BEGIN " + type + "-----", "")
            .replace("-----END " + type + "-----", "").trim());
    }

    private static byte[] decode(JsonObject object, String property) {
        String encoded = object.get(property).getAsString();
        byte[] decoded = Base64.getDecoder().decode(encoded);
        if (!B64.encodeToString(decoded).equals(encoded)) {
            throw new IllegalArgumentException("Non-canonical Base64");
        }
        return decoded;
    }

    private static byte[] ascii(String value) {
        return value.getBytes(StandardCharsets.US_ASCII);
    }
}
