package za.co.genbridge.fleet;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class AndroidNativeContractTest {
    private String source(String relativePath) throws Exception {
        return new String(
            Files.readAllBytes(Paths.get(relativePath)),
            StandardCharsets.UTF_8
        );
    }

    @Test
    public void manifestHasExpectedIdentityDeepLinkAndMinimalPermissions() throws Exception {
        String manifest = source("src/main/AndroidManifest.xml");
        assertTrue(manifest.contains("android:scheme=\"genbridgefleet\""));
        assertTrue(manifest.contains("android:host=\"open\""));
        assertTrue(manifest.contains("android:allowBackup=\"false\""));
        assertTrue(manifest.contains("android:usesCleartextTraffic=\"false\""));
        assertTrue(manifest.contains("android.permission.INTERNET"));
        assertTrue(manifest.contains("android.permission.CAMERA"));
        assertFalse(manifest.contains("ACCESS_FINE_LOCATION"));
        assertFalse(manifest.contains("RECORD_AUDIO"));
        assertFalse(manifest.contains("READ_EXTERNAL_STORAGE"));
        assertFalse(manifest.contains("WRITE_EXTERNAL_STORAGE"));
    }

    @Test
    public void cleartextIsConfinedToDebugSourceSet() throws Exception {
        assertTrue(source("src/debug/AndroidManifest.xml")
            .contains("android:usesCleartextTraffic=\"true\""));
        assertTrue(source("src/release/AndroidManifest.xml")
            .contains("android:usesCleartextTraffic=\"false\""));
        assertTrue(source("src/release/AndroidManifest.xml")
            .contains("android:debuggable=\"false\""));
    }

    @Test
    public void fileProviderDoesNotExposeExternalStorageRoot() throws Exception {
        String paths = source("src/main/res/xml/file_paths.xml");
        assertFalse(paths.contains("<external-path"));
        assertTrue(paths.contains("<external-files-path"));
    }
}
