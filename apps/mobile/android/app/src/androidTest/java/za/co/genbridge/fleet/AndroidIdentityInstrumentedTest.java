package za.co.genbridge.fleet;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AndroidIdentityInstrumentedTest {
    @Test
    public void installedIdentityPermissionsAndDeepLinkMatchContract() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("za.co.genbridge.fleet", context.getPackageName());
        assertEquals("Genbridge Fleet Governance", context.getApplicationInfo()
            .loadLabel(context.getPackageManager()).toString());

        PackageInfo info = context.getPackageManager().getPackageInfo(
            context.getPackageName(), PackageManager.GET_PERMISSIONS);
        assertNotNull(info.requestedPermissions);
        assertTrue(Arrays.asList(info.requestedPermissions)
            .contains("android.permission.INTERNET"));

        Intent deepLink = new Intent(Intent.ACTION_VIEW,
            Uri.parse("genbridgefleet://open/guard"));
        deepLink.setPackage(context.getPackageName());
        assertNotNull(deepLink.resolveActivity(context.getPackageManager()));
    }
}
