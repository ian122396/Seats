VENV_DIR = .venv
PYTHON ?= python

ifeq ($(OS),Windows_NT)
	VENV_PYTHON = $(VENV_DIR)/Scripts/python.exe
	VENV_PIP = $(VENV_DIR)/Scripts/pip.exe
else
	VENV_PYTHON = $(VENV_DIR)/bin/python
	VENV_PIP = $(VENV_DIR)/bin/pip
endif

.PHONY: init dev clean

init:
	$(PYTHON) -m venv $(VENV_DIR)
	$(VENV_PYTHON) -m pip install --upgrade pip
	$(VENV_PIP) install -r backend/requirements.txt
	$(VENV_PYTHON) -m backend.parser

dev:
	$(VENV_PYTHON) tools/dev.py

clean:
	$(PYTHON) -c "import os, shutil; shutil.rmtree('.venv', ignore_errors=True);\nfor path in ['data/seats.db', 'data/seats.json']:\n\tif os.path.exists(path):\n\t\tos.remove(path)"
