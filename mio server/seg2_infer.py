"""Segmentazione metodo 2 (test): inferenza DentalSegmentator con nnU-Net v2.

Gira nell'ambiente separato .venv_seg2 (PyTorch + nnU-Net), lanciato da cbct_server.py come
processo a parte: il server CBCT non carica PyTorch.

Uso: python seg2_infer.py <volume.nii> <etichette.nii.gz> <cartella modello> [max]
("max": anche le immagini specchiate, piu' preciso e circa 8 volte piu' lento)
Stampa su stdout righe "PROGRESS <0-100> <messaggio>" e alla fine "DONE <json>".

Modello: DentalSegmentator (Dot G. et al., 2024), pesi CC BY 4.0, doi 10.5281/zenodo.10829675.
Etichette: 1 cranio superiore/mascella, 2 mandibola, 3 denti superiori, 4 denti inferiori,
5 canale mandibolare.
"""
import json
import sys
import time


def progress(value: float, message: str) -> None:
    print(f"PROGRESS {value:.0f} {message}", flush=True)


def main() -> int:
    input_path, output_path, model_dir = sys.argv[1:4]
    best_quality = len(sys.argv) > 4 and sys.argv[4] == "max"
    started = time.time()
    progress(2, "Avvio di PyTorch...")
    import torch
    from nnunetv2.imageio.simpleitk_reader_writer import SimpleITKIO
    from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor

    use_gpu = torch.cuda.is_available()
    device = torch.device("cuda" if use_gpu else "cpu")

    progress(8, "Caricamento del modello DentalSegmentator...")
    predictor = nnUNetPredictor(
        tile_step_size=0.5,
        use_gaussian=True,
        use_mirroring=best_quality,  # specchiature: un po' piu' preciso, circa 8 volte piu' lento
        perform_everything_on_device=use_gpu,
        device=device,
        verbose=False,
        verbose_preprocessing=False,
        allow_tqdm=False,
    )
    predictor.initialize_from_trained_model_folder(model_dir, use_folds=(0,), checkpoint_name="checkpoint_final.pth")

    progress(15, "Lettura del volume...")
    image, properties = SimpleITKIO().read_images([input_path])

    progress(20, "Segmentazione in corso (rete neurale)..." + ("" if use_gpu else " Senza GPU: può richiedere molti minuti."))
    try:
        labels = predictor.predict_single_npy_array(image, properties, None, None, False)
    except torch.cuda.OutOfMemoryError:
        # scheda video piena: ripete tenendo i risultati intermedi in RAM
        torch.cuda.empty_cache()
        progress(20, "Memoria video insufficiente: ripeto con i dati in RAM (più lento)...")
        predictor.perform_everything_on_device = False
        labels = predictor.predict_single_npy_array(image, properties, None, None, False)

    progress(92, "Salvataggio delle strutture trovate...")
    SimpleITKIO().write_seg(labels.astype("uint8"), output_path, properties)
    print("DONE " + json.dumps({"seconds": round(time.time() - started, 1), "device": "GPU" if use_gpu else "CPU"}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
