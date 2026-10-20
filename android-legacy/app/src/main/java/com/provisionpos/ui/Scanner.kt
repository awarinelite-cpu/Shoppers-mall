package com.provisionpos.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable
fun CameraScanner(modifier: Modifier, paused: Boolean, torch: Boolean, onTorchAvailable: (Boolean) -> Unit, onCode: (String) -> Unit) {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val currentOnCode by rememberUpdatedState(onCode)
    val isPaused by rememberUpdatedState(paused)
    val previewView = remember { PreviewView(ctx).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    var camera by remember { mutableStateOf<Camera?>(null) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(
                Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E,
                Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_CODE_93, Barcode.FORMAT_ITF,
                Barcode.FORMAT_CODABAR, Barcode.FORMAT_QR_CODE
            ).build()
        )
    }

    DisposableEffect(owner) {
        val future = ProcessCameraProvider.getInstance(ctx)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            var last = ""; var lastAt = 0L
            analysis.setAnalyzer(executor) { proxy ->
                val img = proxy.image
                if (img == null || isPaused) { proxy.close(); return@setAnalyzer }
                scanner.process(InputImage.fromMediaImage(img, proxy.imageInfo.rotationDegrees))
                    .addOnSuccessListener { list ->
                        val v = list.firstOrNull { !it.rawValue.isNullOrBlank() }?.rawValue
                        if (v != null) {
                            val now = System.currentTimeMillis()
                            // The same code is ignored for 2s so one product is not added several times by accident.
                            if (v != last || now - lastAt > 2000) { last = v; lastAt = now; currentOnCode(v) }
                        }
                    }
                    .addOnCompleteListener { proxy.close() }
            }
            provider.unbindAll()
            val cam = provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            camera = cam
            onTorchAvailable(cam.cameraInfo.hasFlashUnit())
        }, ContextCompat.getMainExecutor(ctx))
        onDispose {
            runCatching { future.get().unbindAll() }   // releases the camera
            scanner.close(); executor.shutdown()
        }
    }
    LaunchedEffect(torch, camera) { camera?.cameraControl?.enableTorch(torch) }
    AndroidView({ previewView }, modifier)
}

/** mode "sale": continuous scanning adds to the cart. mode "pick": returns one barcode to the caller. */
@Composable
fun ScannerScreen(vm: AppViewModel, mode: String, onBack: () -> Unit, onRegister: (String) -> Unit) {
    val ctx = LocalContext.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var asked by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; asked = true }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }

    var torch by remember { mutableStateOf(false) }
    var hasTorch by remember { mutableStateOf(false) }
    var manual by remember { mutableStateOf(false) }
    var manualText by remember { mutableStateOf("") }
    val notFound = vm.notFoundCode

    Screen(if (mode == "sale") "Scan products" else "Scan barcode", onBack, actions = {
        if (hasTorch) IconButton(onClick = { torch = !torch }) { Icon(if (torch) Icons.Filled.FlashOn else Icons.Filled.FlashOff, "Torch") }
    }) {
        if (!granted) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(if (asked) "Camera permission was denied. You can still type the barcode, or allow the camera in Android Settings > Apps > Provision POS > Permissions."
                     else "The camera is needed to scan barcodes.")
                Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
            }
        } else {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                CameraScanner(Modifier.fillMaxSize(), paused = notFound != null || manual, torch = torch, onTorchAvailable = { hasTorch = it }) { code ->
                    if (mode == "sale") vm.onSaleScan(code) else { vm.pickedBarcode = code; onBack() }
                }
                Box(Modifier.align(Alignment.Center).fillMaxWidth(0.8f).height(150.dp)
                    .border(3.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.medium))
            }
        }
        if (mode == "sale") {
            Text(vm.scanStatus.ifBlank { "Point the camera at a barcode" }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            Text("Items: ${vm.cart.size}   Total: ${com.provisionpos.domain.Money.format(vm.totals().total)}", Modifier.padding(horizontal = 16.dp),
                style = MaterialTheme.typography.titleMedium)
        }
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { manual = true }, Modifier.weight(1f)) { Text("Type barcode") }
            Button(onClick = onBack, Modifier.weight(1f)) { Text(if (mode == "sale") "Done" else "Cancel") }
        }
    }

    if (manual) AlertDialog(onDismissRequest = { manual = false }, title = { Text("Enter barcode") },
        text = { Field(manualText, { manualText = it }, "Barcode / product code") },
        confirmButton = { Button(onClick = {
            val c = manualText.trim(); manual = false; manualText = ""
            if (c.isNotEmpty()) { if (mode == "sale") vm.addByCode(c) else { vm.pickedBarcode = c; onBack() } }
        }) { Text("OK") } },
        dismissButton = { TextButton(onClick = { manual = false }) { Text("Cancel") } })

    if (notFound != null) AlertDialog(onDismissRequest = { vm.notFoundCode = null },
        title = { Text("Product not found") },
        text = { Text("Product not found. Would you like to register this product?\n\nBarcode: $notFound") },
        confirmButton = { Button(onClick = { vm.notFoundCode = null; onRegister(notFound) }) { Text("Register Product") } },
        dismissButton = { Column {
            TextButton(onClick = { vm.notFoundCode = null; manual = true }) { Text("Enter Barcode Manually") }
            TextButton(onClick = { vm.notFoundCode = null }) { Text("Scan Another Product") }
            TextButton(onClick = { vm.notFoundCode = null; onBack() }) { Text("Cancel") }
        } })
}
